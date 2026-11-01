# Mixtapp · Cloud Functions

Funciones en línea del proyecto Firebase `mixtapp-720eb`. Responden a cambios en Firestore, así que no hace falta un backend propio. Es un proyecto aparte de la app Android ([Mixtapp](https://github.com/AndresContreras1/Mixtapp)).

## Funciones

| Función | Se dispara con | Qué hace |
|---|---|---|
| `updateUserInfoInReviews` | `onDocumentUpdated("usuarios/{userId}")` | **Integridad de los datos.** Cada reseña y cada comentario guardan una copia del nombre y la foto de quien los escribió (desnormalización). Cuando el usuario cambia alguno de los dos, la función los actualiza en todas sus reseñas y en sus comentarios de cualquier discusión, con `batch` de hasta 500 operaciones. Si solo cambiaron los contadores o el token, no hace nada. |
| `sendLikeNotification` | `onDocumentCreated("reviews/{reviewId}/likes/{userId}")` | Notifica al **autor** de la reseña cuando alguien le da like: «Nuevo me gusta · A Ana le gustó tu reseña de From Zero». |
| `sendFollowNotification` | `onDocumentCreated("usuarios/{userId}/followers/{followerId}")` | Notifica al usuario que tiene un seguidor nuevo: «Nuevo seguidor · Ana ha comenzado a seguirte». |
| `sendCommentNotification` | `onDocumentCreated("reviews/{reviewId}/comments/{commentId}")` | Notifica al **autor** de la reseña cuando alguien la comenta («Nuevo comentario · Ana comentó tu reseña de From Zero») y, si es una respuesta, al autor del comentario que responde («Nueva respuesta»). Nadie recibe la notificación de su propio comentario. |

Las tres notificaciones pasan por `enviarNotificacion`, que hace dos cosas:

1. **Guarda la notificación** en `usuarios/{id}/notificaciones`, que la pantalla de notificaciones de
   la app escucha en vivo. Cada documento tiene `tipo` (`like`, `comentario`, `respuesta` o
   `seguidor`), quién la hizo (`actorId`, `actorNombre`, `actorFotoUrl`), la reseña (`reviewId`),
   el título y la imagen del álbum, la canción o el artista (`itemTitulo`, `imagenUrl`), `leida` y
   `createdAt`. La app la marca como leída.
2. **Envía el push** con el token de FCM que la app guarda en el campo `fcmtoken` del usuario. Si
   no tiene token, o la app guardó `Vacio` porque el celular no pudo darlo, solo la anota en los
   registros.

La notificación guarda el nombre y la foto que tenía quien la hizo en ese momento, como un mensaje:
la función de integridad no la cambia.

## Estructura

```
mixtapp-functions
├── functions
│   ├── .gitignore
│   ├── index.js
│   ├── package-lock.json
│   └── package.json
├── seed               catálogo real y datos falsos con Faker (ver seed/README.md)
│   ├── .gitignore
│   ├── catalogo.json
│   ├── package-lock.json
│   ├── package.json
│   ├── README.md
│   └── seed.js
├── .firebaserc
├── .gitignore
└── firebase.json
```

## Emulador (Firebase CLI)

`firebase.json` tiene los puertos del emulador: Authentication en `9099`, Firestore en `8080` y la
interfaz en `4000`. La app, en modo debug, se conecta a ellos desde el emulador de Android con la IP
`10.0.2.2`.

```bash
firebase emulators:start --only firestore,auth --project mixtapp-720eb
```

Sin un archivo de reglas, el emulador permite todas las lecturas y escrituras. Los datos se borran
al cerrarlo; para llenarlo está el seed de `seed/`.

Con `--only firestore,auth` las Cloud Functions no corren en el emulador: en modo debug no se crean
notificaciones ni se actualizan las copias del nombre y la foto. Eso se prueba con el Firebase real
(la app en release y las funciones publicadas).

## Publicar

Hacen falta Node y npm. Las Cloud Functions necesitan el plan **Blaze** (pago por uso) en el proyecto de Firebase.

```bash
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase deploy --only functions
```

El deploy tarda unos 3 minutos. Después, en la consola: *Compilación → Functions* aparecen las cuatro funciones con su activador, la región `us-central1` y la versión `v2`. Los tres puntos → **Ver registros** muestran los `logger.log` y los errores.

## Reglas de seguridad de Firestore

Se publican en la consola: *Firestore Database → Reglas*. Reemplazan las del modo de prueba, que vencen el 2026-11-12.

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    //reviews/123
    match /reviews/{reviewId} {
      allow write: if request.resource.data.comentario.size() <= 500
      && request.resource.data.usuarioId == request.auth.uid
      && request.resource.data.tipo in ['album', 'cancion', 'artista']
      && request.resource.data.calificacion is int
      && request.resource.data.calificacion >= 0
      && request.resource.data.calificacion <= 5
      && request.resource.data.likesCount is int
      && request.resource.data.likesCount >= 0
      && request.resource.data.commentsCount is int
      && request.resource.data.commentsCount >= 0
      && (request.resource.data.fechaEscucha == null || request.resource.data.fechaEscucha.size() <= 10);

      //reviews/123/comments/456
      match /comments/{commentId} {
        allow write: if request.resource.data.contenido.size() > 0
        && request.resource.data.contenido.size() <= 500
        && request.resource.data.usuarioId == request.auth.uid
        && request.resource.data.likesCount is int
        && request.resource.data.likesCount >= 0;
      }
    }

    //albumes/123, canciones/123, artistas/123: la app solo cambia el contador de likes
    match /albumes/{itemId} {
      allow write: if request.resource.data.likesCount is int && request.resource.data.likesCount >= 0;
    }
    match /canciones/{itemId} {
      allow write: if request.resource.data.likesCount is int && request.resource.data.likesCount >= 0;
    }
    match /artistas/{itemId} {
      allow write: if request.resource.data.likesCount is int && request.resource.data.likesCount >= 0;
    }

    //usuarios/uid
    match /usuarios/{userId} {
      allow write: if request.resource.data.nombre.size() <= 40
      && request.resource.data.username.size() <= 20
      && (request.resource.data.bio == null || request.resource.data.bio.size() <= 150);

      //usuarios/uid/likes/album_x, usuarios/uid/guardados/album_x: solo los cambia su dueño
      match /likes/{itemId} {
        allow write: if request.auth.uid == userId;
      }
      match /guardados/{itemId} {
        allow write: if request.auth.uid == userId;
      }

      //usuarios/uid/notificaciones/123: las crean las Cloud Functions; el dueño las lee y las marca leídas
      match /notificaciones/{notificacionId} {
        allow read, update: if request.auth.uid == userId;
      }
    }

    //cualquier otra ruta
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Las reglas repiten las validaciones que ya tiene la app: la reseña tiene hasta 500 caracteres, es del usuario autenticado, es de un álbum, una canción o un artista, tiene una calificación entera de 0 a 5 y una fecha `AAAA-MM-DD`; un comentario no está vacío y tiene hasta 500 caracteres; los contadores de likes y comentarios nunca son negativos; los likes y los guardados de un usuario solo los cambia él; y el nombre, el usuario y la biografía respetan sus límites (40, 20 y 150). Las Cloud Functions escriben con el SDK de administrador, que no pasa por las reglas.

Storage también se creó en **modo de prueba**, que vence a los 30 días: antes de la sustentación hay que revisar en *Storage → Reglas* que no haya vencido, o la subida de la foto de perfil falla por permisos.
