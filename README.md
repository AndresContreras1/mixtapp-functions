# Mixtapp · Cloud Functions

Funciones en línea del proyecto Firebase `mixtapp-720eb`. Responden a cambios en Firestore, así que no hace falta un backend propio. Es un proyecto aparte de la app Android ([Mixtapp](https://github.com/AndresContreras1/Mixtapp)).

## Funciones

| Función | Se dispara con | Qué hace |
|---|---|---|
| `updateUserInfoInReviews` | `onDocumentUpdated("usuarios/{userId}")` | **Integridad de los datos.** Cada reseña guarda una copia del nombre y la foto de quien la escribió (desnormalización). Cuando el usuario cambia alguno de los dos, la función los actualiza con un `batch` en todas sus reseñas. Si solo cambiaron los contadores o el token, no hace nada. |
| `sendLikeNotification` | `onDocumentCreated("reviews/{reviewId}/likes/{userId}")` | Envía una notificación push al **autor** de la reseña cuando alguien le da like: «Nuevo me gusta · A Ana le gustó tu reseña de Toxicity». |
| `sendFollowNotification` | `onDocumentCreated("usuarios/{userId}/followers/{followerId}")` | Envía una notificación push al usuario que tiene un seguidor nuevo: «Nuevo seguidor · Ana ha comenzado a seguirte». |
| `sendCommentNotification` | `onDocumentCreated("reviews/{reviewId}/comments/{commentId}")` | Envía una notificación push al **autor** de la reseña cuando alguien la comenta («Nuevo comentario · Ana comentó tu reseña de Toxicity») y, si es una respuesta, al autor del comentario que responde («Nueva respuesta»). Nadie recibe la notificación de su propio comentario. |

Las notificaciones usan el token de FCM que la app guarda en el campo `fcmtoken` del usuario al registrarse y al iniciar sesión. Si el usuario no tiene token, la función lo anota en los registros y no envía nada.

## Estructura

```
mixtapp-functions
├── functions
│   ├── .gitignore
│   ├── index.js
│   ├── package-lock.json
│   └── package.json
├── seed               datos falsos con Faker (ver seed/README.md)
│   ├── .gitignore
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
al cerrarlo; para llenarlo están los datos de Faker de `seed/`.

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
    //reviews/123/likes/uid no
    match /reviews/{reviewId} {
      allow write: if request.resource.data.comentario.size() <= 500
      && request.resource.data.usuarioId == request.auth.uid
      && request.resource.data.calificacion is int
      && request.resource.data.calificacion >= 0
      && request.resource.data.calificacion <= 5
      && request.resource.data.likesCount is int
      && request.resource.data.likesCount >= 0
      && (request.resource.data.fechaEscucha == null || request.resource.data.fechaEscucha.size() <= 10);
    }

    //usuarios/uid
    match /usuarios/{userId} {
      allow write: if request.resource.data.nombre.size() <= 40
      && request.resource.data.username.size() <= 20
      && (request.resource.data.bio == null || request.resource.data.bio.size() <= 150);
    }

    //cualquier otra ruta
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Las reglas repiten las validaciones que ya tiene la app: la reseña tiene hasta 500 caracteres, es del usuario autenticado, tiene una calificación entera de 0 a 5 y una fecha `AAAA-MM-DD`; el contador de likes nunca es negativo; y el nombre, el usuario y la biografía respetan sus límites (40, 20 y 150). `{reviewId}` es el comodín pequeño, así que la subcolección `likes` no queda afectada.

Storage también se creó en **modo de prueba**, que vence a los 30 días: antes de la sustentación hay que revisar en *Storage → Reglas* que no haya vencido, o la subida de la foto de perfil falla por permisos.
