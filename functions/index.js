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

// El nombre y la foto de quien hizo la accion, desde su documento
async function datosDelUsuario(usuarioId) {
    const usuarioDoc = await db.collection("usuarios").doc(usuarioId).get()
    const usuario = usuarioDoc.exists ? usuarioDoc.data() : {}

    return {
        nombre: usuario.nombre || usuario.username || "Alguien",
        fotoUrl: usuario.fotoUrl || null,
    }
}

// "tu reseña de From Zero", o "tu reseña" si la copia del item no tiene titulo
function tuResena(resena) {
    const titulo = resena.item ? resena.item.titulo : ""
    return titulo ? `tu reseña de ${titulo}` : "tu reseña"
}

// Integridad de los datos: cada resena y cada comentario guardan una copia del nombre y la foto
// de quien los escribio. Cuando el usuario los cambia, se actualizan en todas las copias
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

        logger.log("Actualizando reseñas y comentarios del usuario:", userId)

        const misResenas = await db.collection("reviews").where("usuarioId", "==", userId).get()
        const referencias = misResenas.docs.map((resenaDoc) => resenaDoc.ref)

        // Sus comentarios pueden estar en la discusion de cualquier resena: se buscan en la
        // subcoleccion comments de cada una
        const todasLasResenas = await db.collection("reviews").get()
        for (const resenaDoc of todasLasResenas.docs) {
            const misComentarios = await resenaDoc.ref
                .collection("comments")
                .where("usuarioId", "==", userId)
                .get()
            misComentarios.forEach((comentarioDoc) => referencias.push(comentarioDoc.ref))
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

        const resenaDoc = await db.collection("reviews").doc(reviewId).get()
        if (!resenaDoc.exists) {
            logger.log(`La reseña ${reviewId} ya no existe.`)
            return
        }
        const resena = resenaDoc.data()

        // La notificacion es para quien escribio la resena, no para quien dio el like
        if (resena.usuarioId === userId) {
            logger.log(`El usuario ${userId} le dio like a su propia reseña, no se notifica.`)
            return
        }

        const quienDioLike = await datosDelUsuario(userId)
        await enviarNotificacion(
            resena.usuarioId,
            {
                tipo: "like",
                actorId: userId,
                actorNombre: quienDioLike.nombre,
                actorFotoUrl: quienDioLike.fotoUrl,
                reviewId: reviewId,
                itemTitulo: resena.item ? resena.item.titulo : "",
                imagenUrl: resena.item ? resena.item.imagenUrl : null,
            },
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
            {
                tipo: "seguidor",
                actorId: followerId,
                actorNombre: seguidor.nombre,
                actorFotoUrl: seguidor.fotoUrl,
                reviewId: null,
                itemTitulo: "",
                imagenUrl: null,
            },
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

        const resenaDoc = await db.collection("reviews").doc(reviewId).get()
        if (!resenaDoc.exists) {
            logger.log(`La reseña ${reviewId} ya no existe.`)
            return
        }
        const resena = resenaDoc.data()

        // Se muestra el nombre que se copio en el comentario, no el id
        const comentarista = {
            nombre: (comentario.usuario && comentario.usuario.nombre) || "Alguien",
            fotoUrl: (comentario.usuario && comentario.usuario.fotoUrl) || null,
        }

        // Los destinatarios: el autor de la resena y, si es respuesta, el autor del comentario
        // principal. Nadie recibe la notificacion de su propio comentario
        const destinatarios = new Set([resena.usuarioId])
        if (comentario.parentCommentId) {
            const padreDoc = await resenaDoc.ref.collection("comments").doc(comentario.parentCommentId).get()
            if (padreDoc.exists) destinatarios.add(padreDoc.data().usuarioId)
        }
        destinatarios.delete(comentaristaId)

        for (const destinatarioId of destinatarios) {
            const esLaResena = destinatarioId === resena.usuarioId

            await enviarNotificacion(
                destinatarioId,
                {
                    tipo: esLaResena ? "comentario" : "respuesta",
                    actorId: comentaristaId,
                    actorNombre: comentarista.nombre,
                    actorFotoUrl: comentarista.fotoUrl,
                    reviewId: reviewId,
                    itemTitulo: resena.item ? resena.item.titulo : "",
                    imagenUrl: resena.item ? resena.item.imagenUrl : null,
                },
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

        // La imagen y el titulo salen de la copia del item en la resena
        const resenaDoc = await resenaRef.get()
        const resena = resenaDoc.exists ? resenaDoc.data() : {}
        const quienDioLike = await datosDelUsuario(userId)
        await enviarNotificacion(
            comentario.usuarioId,
            {
                tipo: "like_comentario",
                actorId: userId,
                actorNombre: quienDioLike.nombre,
                actorFotoUrl: quienDioLike.fotoUrl,
                reviewId: reviewId,
                itemTitulo: resena.item ? resena.item.titulo : "",
                imagenUrl: resena.item ? resena.item.imagenUrl : null,
            },
            "Nuevo me gusta",
            `A ${quienDioLike.nombre} le gustó tu comentario.`
        )
    }
)
