const {
    onDocumentUpdated,
    onDocumentCreated,
} = require("firebase-functions/v2/firestore")
const logger = require("firebase-functions/logger")
const admin = require("firebase-admin")

admin.initializeApp()
const db = admin.firestore()

// Integridad de los datos: cada resena guarda una copia del nombre y la foto de quien la
// escribio. Cuando el usuario los cambia, se actualizan en todas sus resenas
exports.updateUserInfoInReviews = onDocumentUpdated(
    "usuarios/{userId}",
    async (event) => {
        const userId = event.params.userId

        const beforeData = event.data.before.data()
        const afterData = event.data.after.data()

        // Los contadores y el token tambien cambian este documento: si no cambio lo que se
        // copia en las resenas, no se hace nada
        if (beforeData.fotoUrl === afterData.fotoUrl && beforeData.nombre === afterData.nombre) {
            logger.log("Sin cambios en el nombre ni en la foto, no se actualiza nada.")
            return
        }

        logger.log("Actualizando reseñas del usuario:", userId)

        const reviewsSnapshot = await db
            .collection("reviews")
            .where("usuarioId", "==", userId)
            .get()

        const batch = db.batch()

        reviewsSnapshot.forEach((reviewDoc) => {
            batch.update(reviewDoc.ref, {
                "usuario.nombre": afterData.nombre || "",
                // Firestore no acepta undefined como valor: sin foto queda null
                "usuario.fotoUrl": afterData.fotoUrl || null,
            })
        })

        await batch.commit()
        logger.log("Reseñas actualizadas exitosamente para el usuario:", userId)
    }
)

// Notificacion al autor de una resena cuando alguien le da like
exports.sendLikeNotification = onDocumentCreated(
    "reviews/{reviewId}/likes/{userId}",
    async (event) => {
        const reviewId = event.params.reviewId
        const userId = event.params.userId

        const reviewDoc = await db.collection("reviews").doc(reviewId).get()
        if (!reviewDoc.exists) {
            logger.log(`La reseña ${reviewId} ya no existe.`)
            return
        }
        const reviewData = reviewDoc.data()

        // La notificacion es para quien escribio la resena, no para quien dio el like
        const autorId = reviewData.usuarioId
        if (autorId === userId) {
            logger.log(`El usuario ${userId} le dio like a su propia reseña, no se notifica.`)
            return
        }

        const autorDoc = await db.collection("usuarios").doc(autorId).get()
        const autorToken = autorDoc.exists ? autorDoc.data().fcmtoken : null

        // Se muestra el nombre de quien dio like, no su id
        const likerDoc = await db.collection("usuarios").doc(userId).get()
        const likerData = likerDoc.exists ? likerDoc.data() : {}
        const likerName = likerData.nombre || likerData.username || "Alguien"
        const tituloAlbum = reviewData.album ? reviewData.album.titulo : ""

        if (autorToken) {
            const message = {
                token: autorToken,
                notification: {
                    title: "Nuevo me gusta",
                    body: `A ${likerName} le gustó tu reseña de ${tituloAlbum}.`,
                },
            }

            try {
                await admin.messaging().send(message)
                logger.log(`Notificación enviada a ${autorId} por el like de ${likerName}`)
            } catch (error) {
                logger.error(`Error al enviar notificación a ${autorId}:`, error)
            }
        } else {
            logger.log(`El usuario ${autorId} no tiene token FCM, no se envía la notificación.`)
        }
    }
)

// Notificacion al usuario que tiene un seguidor nuevo
exports.sendFollowNotification = onDocumentCreated(
    "usuarios/{userId}/followers/{followerId}",
    async (event) => {
        const userId = event.params.userId
        const followerId = event.params.followerId

        // La notificacion es para el usuario seguido (userId), no para followerId
        const userDoc = await db.collection("usuarios").doc(userId).get()
        const userToken = userDoc.exists ? userDoc.data().fcmtoken : null

        const followerDoc = await db.collection("usuarios").doc(followerId).get()
        const followerData = followerDoc.exists ? followerDoc.data() : {}
        const followerName = followerData.nombre || followerData.username || "Alguien"

        if (userToken) {
            const message = {
                token: userToken,
                notification: {
                    title: "Nuevo seguidor",
                    body: `${followerName} ha comenzado a seguirte.`,
                },
            }

            try {
                await admin.messaging().send(message)
                logger.log(`Notificación enviada a ${userId} por nuevo seguidor: ${followerName}`)
            } catch (error) {
                logger.error(`Error al enviar notificación a ${userId}:`, error)
            }
        } else {
            logger.log(`El usuario ${userId} no tiene token FCM, no se envía la notificación.`)
        }
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

        const reviewDoc = await db.collection("reviews").doc(reviewId).get()
        if (!reviewDoc.exists) {
            logger.log(`La reseña ${reviewId} ya no existe.`)
            return
        }
        const reviewData = reviewDoc.data()

        // Se muestra el nombre que se copio en el comentario, no el id
        const comentaristaName = (comentario.usuario && comentario.usuario.nombre) || "Alguien"
        const tituloAlbum = reviewData.album ? reviewData.album.titulo : ""

        // Los destinatarios: el autor de la reseña y, si es respuesta, el autor del comentario
        // principal. Nadie recibe la notificacion de su propio comentario
        const destinatarios = new Set([reviewData.usuarioId])
        if (comentario.parentCommentId) {
            const padreDoc = await db.collection("reviews").doc(reviewId)
                .collection("comments").doc(comentario.parentCommentId).get()
            if (padreDoc.exists) destinatarios.add(padreDoc.data().usuarioId)
        }
        destinatarios.delete(comentaristaId)

        for (const destinatarioId of destinatarios) {
            const destinatarioDoc = await db.collection("usuarios").doc(destinatarioId).get()
            const destinatarioToken = destinatarioDoc.exists ? destinatarioDoc.data().fcmtoken : null

            if (!destinatarioToken) {
                logger.log(`El usuario ${destinatarioId} no tiene token FCM, no se envía la notificación.`)
                continue
            }

            const esLaResena = destinatarioId === reviewData.usuarioId
            const message = {
                token: destinatarioToken,
                notification: {
                    title: esLaResena ? "Nuevo comentario" : "Nueva respuesta",
                    body: esLaResena
                        ? `${comentaristaName} comentó tu reseña de ${tituloAlbum}.`
                        : `${comentaristaName} respondió tu comentario.`,
                },
            }

            try {
                await admin.messaging().send(message)
                logger.log(`Notificación enviada a ${destinatarioId} por el comentario de ${comentaristaName}`)
            } catch (error) {
                logger.error(`Error al enviar notificación a ${destinatarioId}:`, error)
            }
        }
    }
)
