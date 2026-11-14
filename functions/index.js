const {
    onDocumentUpdated,
    onDocumentCreated,
} = require("firebase-functions/v2/firestore")
const logger = require("firebase-functions/logger")
const admin = require("firebase-admin")

admin.initializeApp()
const db = admin.firestore()

// Un batch acepta hasta 500 operaciones
const MAX_OPERACIONES_POR_BATCH = 500
// Lo que guarda la app cuando el celular no pudo dar su token de FCM
const TOKEN_VACIO = "Vacio"
// La notificacion de un seguidor no es de ningun album, cancion ni artista
const SIN_ITEM = { titulo: "", imagenUrl: null }

// Aplica el mismo cambio a muchos documentos, de a 500 por batch
async function actualizarPorLotes(referencias, cambios) {
    for (let inicio = 0; inicio < referencias.length; inicio += MAX_OPERACIONES_POR_BATCH) {
        const batch = db.batch()
        referencias
            .slice(inicio, inicio + MAX_OPERACIONES_POR_BATCH)
            .forEach((referencia) => batch.update(referencia, cambios))
        await batch.commit()
    }
}

// Toda notificacion hace lo mismo: queda guardada en usuarios/{id}/notificaciones, que la app
// escucha en vivo, y si el usuario tiene el token de su celular tambien le llega como push
async function enviarNotificacion(destinatarioId, notificacion, titulo, cuerpo) {
    const destinatarioRef = db.collection("usuarios").doc(destinatarioId)
    const destinatarioDoc = await destinatarioRef.get()
    if (!destinatarioDoc.exists) {
        logger.log(`El usuario ${destinatarioId} no tiene documento, no se notifica.`)
        return
    }

    await destinatarioRef.collection("notificaciones").add({
        ...notificacion,
        leida: false,
        createdAt: new Date().toISOString(),
    })

    const token = destinatarioDoc.data().fcmtoken
    if (!token || token === TOKEN_VACIO) {
        logger.log(`El usuario ${destinatarioId} no tiene token FCM, no se envía el push.`)
        return
    }

    try {
        await admin.messaging().send({
            token: token,
            notification: { title: titulo, body: cuerpo },
        })
        logger.log(`Notificación enviada a ${destinatarioId}: ${cuerpo}`)
    } catch (error) {
        logger.error(`Error al enviar la notificación a ${destinatarioId}:`, error)
    }
}

// Los campos que la app lee de cada notificacion (NotificacionDto): `actor` es el nombre y la foto
// de quien hizo la accion e `item` el titulo y la imagen de lo que se muestra. leida y createdAt
// los pone enviarNotificacion
function armarNotificacion(tipo, actorId, actor, reviewId, item) {
    return {
        tipo: tipo,
        actorId: actorId,
        actorNombre: actor.nombre,
        actorFotoUrl: actor.fotoUrl,
        reviewId: reviewId,
        itemTitulo: item.titulo,
        imagenUrl: item.imagenUrl,
    }
}

// El nombre y la foto de quien hizo la accion, desde su documento
async function datosDelUsuario(usuarioId) {
    const usuarioDoc = await db.collection("usuarios").doc(usuarioId).get()
    const usuario = usuarioDoc.exists ? usuarioDoc.data() : {}

    return {
        nombre: usuario.nombre || usuario.username || "Alguien",
        fotoUrl: usuario.fotoUrl || null,
    }
}

// La resena de la notificacion; null si la borraron antes de que corriera la funcion
async function buscarResena(reviewId) {
    const resenaDoc = await db.collection("reviews").doc(reviewId).get()
    if (!resenaDoc.exists) {
        logger.log(`La reseña ${reviewId} ya no existe.`)
        return null
    }
    return resenaDoc.data()
}

// El titulo y la imagen de la copia del item que guarda la resena; vacios si no la tiene
function itemDeLaResena(resena) {
    const item = (resena && resena.item) || {}
    return {
        titulo: item.titulo || "",
        imagenUrl: item.imagenUrl || null,
    }
}

// "tu reseña de From Zero", o "tu reseña" si la copia del item no tiene titulo
function tuResena(resena) {
    const titulo = itemDeLaResena(resena).titulo
    return titulo ? `tu reseña de ${titulo}` : "tu reseña"
}

// "lo que escuchas: From Zero", o "lo que escuchas" si lo que suena no tiene titulo
function loQueEscuchas(titulo) {
    return titulo ? `lo que escuchas: ${titulo}` : "lo que escuchas"
}

// Los comentarios de un usuario pueden estar en la discusion de cualquier resena: se buscan en la
// subcoleccion comments de cada una. Las consultas no dependen entre si, asi que se lanzan todas
// a la vez con Promise.all y se espera una sola vez, en vez de una por una dentro del for
async function referenciasDeSusComentarios(userId) {
    const todasLasResenas = await db.collection("reviews").get()
    const comentariosPorResena = await Promise.all(
        todasLasResenas.docs.map((resenaDoc) =>
            resenaDoc.ref.collection("comments").where("usuarioId", "==", userId).get()
        )
    )

    const referencias = []
    comentariosPorResena.forEach((susComentarios) =>
        susComentarios.forEach((comentarioDoc) => referencias.push(comentarioDoc.ref))
    )
    return referencias
}

// El voto de un usuario en un duelo tiene su uid como id (duelos/{dueloId}/votos/{userId}): se pide
// el de cada duelo a la vez y quedan los que existen
async function referenciasDeSusVotos(userId) {
    const duelos = await db.collection("duelos").get()
    const votos = await Promise.all(
        duelos.docs.map((dueloDoc) => dueloDoc.ref.collection("votos").doc(userId).get())
    )

    return votos.filter((votoDoc) => votoDoc.exists).map((votoDoc) => votoDoc.ref)
}

// Integridad de los datos: sus resenas, sus comentarios, lo que esta escuchando, sus mixtapes y
// sus votos en los duelos guardan una copia de su nombre y su foto en el map usuario. Cuando el
// usuario cambia alguno de los dos, se actualizan todas las copias. El nombre de la funcion se
// queda igual aunque ya no son solo resenas: es el de la funcion publicada
exports.updateUserInfoInReviews = onDocumentUpdated(
    "usuarios/{userId}",
    async (event) => {
        const userId = event.params.userId

        const antes = event.data.before.data()
        const despues = event.data.after.data()

        // Los contadores y el token tambien cambian este documento: si no cambio lo que se
        // copia, no se hace nada
        if (antes.fotoUrl === despues.fotoUrl && antes.nombre === despues.nombre) {
            logger.log("Sin cambios en el nombre ni en la foto, no se actualiza nada.")
            return
        }

        logger.log("Actualizando las copias del nombre y la foto del usuario:", userId)

        const susResenas = await db.collection("reviews").where("usuarioId", "==", userId).get()
        const susComentarios = await referenciasDeSusComentarios(userId)
        const susMixtapes = await db.collection("mixtapes").where("usuarioId", "==", userId).get()
        const susVotos = await referenciasDeSusVotos(userId)
        const referencias = [
            ...susResenas.docs.map((resenaDoc) => resenaDoc.ref),
            ...susComentarios,
            ...susMixtapes.docs.map((mixtapeDoc) => mixtapeDoc.ref),
            ...susVotos,
        ]

        // Lo que esta escuchando ("sonando ahora") tiene su uid como id
        const sonandoRef = db.collection("sonando").doc(userId)
        const sonandoDoc = await sonandoRef.get()
        if (sonandoDoc.exists) {
            referencias.push(sonandoRef)
        }

        await actualizarPorLotes(referencias, {
            "usuario.nombre": despues.nombre || "",
            // Firestore no acepta undefined como valor: sin foto queda null
            "usuario.fotoUrl": despues.fotoUrl || null,
        })
        logger.log(`${referencias.length} copias actualizadas para el usuario:`, userId)
    }
)

// Notificacion al autor de una resena cuando alguien le da like
exports.sendLikeNotification = onDocumentCreated(
    "reviews/{reviewId}/likes/{userId}",
    async (event) => {
        const reviewId = event.params.reviewId
        const userId = event.params.userId

        const resena = await buscarResena(reviewId)
        if (!resena) return

        // La notificacion es para quien escribio la resena, no para quien dio el like
        if (resena.usuarioId === userId) {
            logger.log(`El usuario ${userId} le dio like a su propia reseña, no se notifica.`)
            return
        }

        const quienDioLike = await datosDelUsuario(userId)
        await enviarNotificacion(
            resena.usuarioId,
            armarNotificacion("like", userId, quienDioLike, reviewId, itemDeLaResena(resena)),
            "Nuevo me gusta",
            `A ${quienDioLike.nombre} le gustó ${tuResena(resena)}.`
        )
    }
)

// Notificacion al usuario que tiene un seguidor nuevo
exports.sendFollowNotification = onDocumentCreated(
    "usuarios/{userId}/followers/{followerId}",
    async (event) => {
        const userId = event.params.userId
        const followerId = event.params.followerId

        // La notificacion es para el usuario seguido (userId), no para followerId
        const seguidor = await datosDelUsuario(followerId)
        await enviarNotificacion(
            userId,
            armarNotificacion("seguidor", followerId, seguidor, null, SIN_ITEM),
            "Nuevo seguidor",
            `${seguidor.nombre} ha comenzado a seguirte.`
        )
    }
)

// Notificacion al autor de una resena cuando alguien la comenta. Si es una respuesta, tambien al
// autor del comentario que responde
exports.sendCommentNotification = onDocumentCreated(
    "reviews/{reviewId}/comments/{commentId}",
    async (event) => {
        const reviewId = event.params.reviewId
        const comentario = event.data.data()
        const comentaristaId = comentario.usuarioId

        const resena = await buscarResena(reviewId)
        if (!resena) return

        // Se muestra el nombre que se copio en el comentario, no el id
        const comentarista = {
            nombre: (comentario.usuario && comentario.usuario.nombre) || "Alguien",
            fotoUrl: (comentario.usuario && comentario.usuario.fotoUrl) || null,
        }

        // Los destinatarios: el autor de la resena y, si es respuesta, el autor del comentario
        // principal. Nadie recibe la notificacion de su propio comentario
        const destinatarios = new Set([resena.usuarioId])
        if (comentario.parentCommentId) {
            const padreDoc = await db.collection("reviews").doc(reviewId)
                .collection("comments").doc(comentario.parentCommentId).get()
            if (padreDoc.exists) destinatarios.add(padreDoc.data().usuarioId)
        }
        destinatarios.delete(comentaristaId)

        for (const destinatarioId of destinatarios) {
            const esLaResena = destinatarioId === resena.usuarioId

            await enviarNotificacion(
                destinatarioId,
                armarNotificacion(
                    esLaResena ? "comentario" : "respuesta",
                    comentaristaId,
                    comentarista,
                    reviewId,
                    itemDeLaResena(resena)
                ),
                esLaResena ? "Nuevo comentario" : "Nueva respuesta",
                esLaResena
                    ? `${comentarista.nombre} comentó ${tuResena(resena)}.`
                    : `${comentarista.nombre} respondió tu comentario.`
            )
        }
    }
)

// Notificacion al autor de un comentario cuando alguien le da like
exports.sendCommentLikeNotification = onDocumentCreated(
    "reviews/{reviewId}/comments/{commentId}/likes/{userId}",
    async (event) => {
        const reviewId = event.params.reviewId
        const commentId = event.params.commentId
        const userId = event.params.userId

        const resenaRef = db.collection("reviews").doc(reviewId)
        const comentarioDoc = await resenaRef.collection("comments").doc(commentId).get()
        if (!comentarioDoc.exists) {
            logger.log(`El comentario ${commentId} ya no existe.`)
            return
        }
        const comentario = comentarioDoc.data()

        // La notificacion es para quien escribio el comentario, no para quien dio el like
        if (comentario.usuarioId === userId) {
            logger.log(`El usuario ${userId} le dio like a su propio comentario, no se notifica.`)
            return
        }

        // La imagen y el titulo salen de la copia del item en la resena; si ya no existe, la
        // notificacion llega sin ellos
        const resena = await buscarResena(reviewId)
        const quienDioLike = await datosDelUsuario(userId)
        await enviarNotificacion(
            comentario.usuarioId,
            armarNotificacion("like_comentario", userId, quienDioLike, reviewId, itemDeLaResena(resena)),
            "Nuevo me gusta",
            `A ${quienDioLike.nombre} le gustó tu comentario.`
        )
    }
)

// Notificacion a quien esta escuchando algo cuando alguien le da 🔥. El id de la reaccion lleva
// el item y el uid de quien reacciono, y el documento solo guarda usuarioId, itemId y createdAt:
// el nombre y la foto de quien reacciono salen de su documento en usuarios
exports.sendSonandoReactionNotification = onDocumentCreated(
    "sonando/{userId}/reacciones/{reaccionId}",
    async (event) => {
        const userId = event.params.userId
        const reaccion = event.data.data()

        // Nadie se reacciona a si mismo, pero si pasa no se notifica
        if (reaccion.usuarioId === userId) {
            logger.log(`El usuario ${userId} reaccionó a lo suyo, no se notifica.`)
            return
        }

        // El titulo y la portada salen de lo que esta sonando
        const sonandoDoc = await db.collection("sonando").doc(userId).get()
        const sonando = sonandoDoc.exists ? sonandoDoc.data() : {}
        const loQueSuena = { titulo: sonando.titulo || "", imagenUrl: sonando.imagenUrl || null }
        const quienReacciono = await datosDelUsuario(reaccion.usuarioId)
        await enviarNotificacion(
            userId,
            armarNotificacion("reaccion_sonando", reaccion.usuarioId, quienReacciono, null, loQueSuena),
            "Nuevo 🔥",
            `${quienReacciono.nombre} le dio 🔥 a ${loQueEscuchas(loQueSuena.titulo)}.`
        )
    }
)
