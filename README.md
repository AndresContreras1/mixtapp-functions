# Mixtapp · Cloud Functions

Funciones en línea del proyecto Firebase `mixtapp-720eb`. Responden a cambios en Firestore, así que no hace falta un backend propio. Es un proyecto aparte de la app Android ([Mixtapp](https://github.com/AndresContreras1/Mixtapp)).

## Funciones

| Función | Se dispara con | Qué hace |
|---|---|---|
| `updateUserInfoInReviews` | `onDocumentUpdated("usuarios/{userId}")` | **Integridad de los datos.** Las reseñas, los comentarios, lo que está escuchando (`sonando/{userId}`), las mixtapes y los votos de los duelos (`duelos/{dueloId}/votos/{userId}`) guardan una copia del nombre y la foto de quien los escribió en el map `usuario` (desnormalización). Cuando el usuario cambia alguno de los dos, la función actualiza todas las copias con `batch` de hasta 500 operaciones. Sus comentarios y sus votos se buscan en la subcolección de cada reseña y de cada duelo, con todas las consultas a la vez (`Promise.all`). Si solo cambiaron los contadores o el token, no hace nada. El nombre se conserva porque es el de la función publicada. |
| `sendLikeNotification` | `onDocumentCreated("reviews/{reviewId}/likes/{userId}")` | Notifica al **autor** de la reseña cuando alguien le da like: «Nuevo me gusta · A Ana le gustó tu reseña de From Zero». |
| `sendFollowNotification` | `onDocumentCreated("usuarios/{userId}/followers/{followerId}")` | Notifica al usuario que tiene un seguidor nuevo: «Nuevo seguidor · Ana ha comenzado a seguirte». |
| `sendCommentNotification` | `onDocumentCreated("reviews/{reviewId}/comments/{commentId}")` | Notifica al **autor** de la reseña cuando alguien la comenta («Nuevo comentario · Ana comentó tu reseña de From Zero») y, si es una respuesta, al autor del comentario que responde («Nueva respuesta»). Nadie recibe la notificación de su propio comentario. |
| `sendCommentLikeNotification` | `onDocumentCreated("reviews/{reviewId}/comments/{commentId}/likes/{userId}")` | Notifica al **autor** de un comentario cuando alguien le da like: «Nuevo me gusta · A Ana le gustó tu comentario». |
| `sendSonandoReactionNotification` | `onDocumentCreated("sonando/{userId}/reacciones/{reaccionId}")` | Notifica a quien está escuchando algo cuando alguien le da 🔥: «Nuevo 🔥 · Ana le dio 🔥 a lo que escuchas: From Zero» («… a lo que escuchas» si no tiene título). La reacción solo guarda `usuarioId`, `itemId` y `createdAt`: el nombre y la foto de quien reaccionó salen de su documento en `usuarios`. |

Las cinco notificaciones pasan por `enviarNotificacion`, que hace dos cosas:

1. **Guarda la notificación** en `usuarios/{id}/notificaciones`, que la pantalla de notificaciones de
   la app escucha en vivo. Cada documento tiene `tipo` (`like`, `like_comentario`, `comentario`,
   `respuesta`, `seguidor` o `reaccion_sonando`), quién la hizo (`actorId`, `actorNombre`,
   `actorFotoUrl`), la reseña (`reviewId`, `null` en `seguidor` y `reaccion_sonando`), el título y la
   imagen del álbum, la canción o el artista de la reseña o de lo que está sonando (`itemTitulo`,
   `imagenUrl`; vacíos en `seguidor`), `leida` y `createdAt`. La app la marca como leída. El objeto lo
   arma `armarNotificacion`, con los mismos nombres de campo que lee la app.
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
│   ├── historias.json
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
notificaciones ni se actualizan las copias del nombre y la foto. Es el comando para usar la app en
debug. Eso se prueba con el Firebase real (la app en release y las funciones publicadas) o agregando
`functions` a la lista, con `npm install` ya hecho en `functions/`:

```bash
firebase emulators:start --only firestore,auth,functions --project mixtapp-720eb
```

Así las funciones corren con el `index.js` local y escriben en el Firestore del emulador: sirve para
probar un cambio en ellas antes del deploy (un like de la app o del seed crea su notificación). El
push depende de Cloud Messaging, que no se emula: si falla, el error queda en la terminal y la
notificación igual queda guardada.

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

El deploy tarda unos 3 minutos. Después, en la consola: *Compilación → Functions* aparecen las seis funciones con su activador, la región `us-central1` y la versión `v2`. Los tres puntos → **Ver registros** muestran los `logger.log` y los errores.

## Reglas de seguridad de Firestore

Se publican en la consola: *Firestore Database → Reglas* → **Publicar**. Las definitivas reemplazaron las del modo de prueba el 2026-11-14; cada vez que cambia este bloque hay que copiarlo allí y publicarlo de nuevo.

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    //reviews/123: la ubicacion es null o una latitud y una longitud validas; es decimal, por eso
    //is number (is int la rechazaria)
    match /reviews/{reviewId} {
      allow write: if request.resource.data.comentario.size() > 0
      && request.resource.data.comentario.size() <= 500
      && request.resource.data.usuarioId == request.auth.uid
      && request.resource.data.tipo in ['album', 'cancion', 'artista']
      && request.resource.data.calificacion is int
      && request.resource.data.calificacion >= 0
      && request.resource.data.calificacion <= 5
      && request.resource.data.likesCount is int
      && request.resource.data.likesCount >= 0
      && request.resource.data.commentsCount is int
      && request.resource.data.commentsCount >= 0
      && (request.resource.data.fechaEscucha == null || request.resource.data.fechaEscucha.size() <= 10)
      && (request.resource.data.latitud == null || (request.resource.data.latitud is number
        && request.resource.data.latitud >= -90
        && request.resource.data.latitud <= 90))
      && (request.resource.data.longitud == null || (request.resource.data.longitud is number
        && request.resource.data.longitud >= -180
        && request.resource.data.longitud <= 180));

      //reviews/123/likes/uid: cada usuario solo escribe su propio like
      match /likes/{userId} {
        allow write: if request.auth.uid == userId;
      }

      //reviews/123/comments/456
      match /comments/{commentId} {
        allow write: if request.resource.data.contenido.size() > 0
        && request.resource.data.contenido.size() <= 500
        && request.resource.data.usuarioId == request.auth.uid
        && request.resource.data.likesCount is int
        && request.resource.data.likesCount >= 0;

        //reviews/123/comments/456/likes/uid: cada usuario solo escribe su propio like
        match /likes/{userId} {
          allow write: if request.auth.uid == userId;
        }
      }
    }

    //albumes/123, canciones/123, artistas/123: la app solo cambia el contador de likes, y en
    //likes/uid cada usuario solo escribe su propio like
    match /albumes/{itemId} {
      allow write: if request.resource.data.likesCount is int && request.resource.data.likesCount >= 0;

      match /likes/{userId} {
        allow write: if request.auth.uid == userId;
      }
    }
    match /canciones/{itemId} {
      allow write: if request.resource.data.likesCount is int && request.resource.data.likesCount >= 0;

      match /likes/{userId} {
        allow write: if request.auth.uid == userId;
      }
    }
    match /artistas/{itemId} {
      allow write: if request.resource.data.likesCount is int && request.resource.data.likesCount >= 0;

      match /likes/{userId} {
        allow write: if request.auth.uid == userId;
      }
    }

    //historias/album_x: los datos curiosos solo se leen; los carga el seed
    match /historias/{itemId} {
      allow write: if false;
    }

    //duelos/dia_20397_album: el primer voto del dia lo crea; los contadores nunca son negativos
    match /duelos/{dueloId} {
      allow write: if request.resource.data.tipo in ['album', 'cancion', 'artista']
      && request.resource.data.votosA is int
      && request.resource.data.votosA >= 0
      && request.resource.data.votosB is int
      && request.resource.data.votosB >= 0;

      //duelos/dia_20397_album/votos/uid: cada usuario solo escribe su voto, por a o por b
      match /votos/{userId} {
        allow write: if request.auth.uid == userId
        && request.resource.data.opcion in ['a', 'b']
        && request.resource.data.opinion.size() <= 140;
      }
    }

    //mixtapes/123: solo quien la creo la escribe; nombre de hasta 40, descripcion de hasta 150,
    //hasta 4 portadas y el contador de items nunca es negativo
    match /mixtapes/{mixtapeId} {
      allow create: if request.resource.data.usuarioId == request.auth.uid
      && request.resource.data.nombre.size() > 0
      && request.resource.data.nombre.size() <= 40
      && (request.resource.data.descripcion == null || request.resource.data.descripcion.size() <= 150)
      && request.resource.data.itemsCount is int
      && request.resource.data.itemsCount >= 0
      && request.resource.data.portadas.size() <= 4;
      allow update: if resource.data.usuarioId == request.auth.uid
      && request.resource.data.usuarioId == request.auth.uid
      && request.resource.data.nombre.size() > 0
      && request.resource.data.nombre.size() <= 40
      && (request.resource.data.descripcion == null || request.resource.data.descripcion.size() <= 150)
      && request.resource.data.itemsCount is int
      && request.resource.data.itemsCount >= 0
      && request.resource.data.portadas.size() <= 4;
      allow delete: if resource.data.usuarioId == request.auth.uid;

      //mixtapes/123/items/album_x: un album, una cancion o un artista. El dueño de la mixtape esta
      //en el documento padre y la regla no lo ve: pide un usuario autenticado y un tipo valido
      match /items/{itemId} {
        allow create, update: if request.auth != null
        && request.resource.data.tipo in ['album', 'cancion', 'artista'];
        allow delete: if request.auth != null;
      }
    }

    //sonando/uid: lo que escucha el usuario. Solo el lo pone y lo quita; los demas lo actualizan
    //al reaccionar, y el contador de reacciones nunca es negativo
    match /sonando/{userId} {
      allow create: if request.auth.uid == userId
      && request.resource.data.reaccionesCount is int
      && request.resource.data.reaccionesCount >= 0;
      allow update: if request.resource.data.reaccionesCount is int
      && request.resource.data.reaccionesCount >= 0;
      allow delete: if request.auth.uid == userId;

      //sonando/uid/reacciones/album_x_uid: cada usuario solo escribe su propia reaccion; la borra
      //quien reacciono o el dueño, cuando pone otra cosa o deja de escuchar
      match /reacciones/{reaccionId} {
        allow create, update: if request.resource.data.usuarioId == request.auth.uid;
        allow delete: if resource.data.usuarioId == request.auth.uid || request.auth.uid == userId;
      }
    }

    //usuarios/uid
    match /usuarios/{userId} {
      allow write: if request.resource.data.nombre.size() <= 40
      && request.resource.data.username.size() <= 20
      && (request.resource.data.bio == null || request.resource.data.bio.size() <= 150)
      && (request.resource.data.instagram == null || request.resource.data.instagram.size() <= 30);

      //usuarios/A/following/B y usuarios/B/followers/A: los dos los escribe A cuando sigue a B o
      //deja de seguirlo
      match /following/{seguidoId} {
        allow write: if request.auth.uid == userId;
      }
      match /followers/{seguidorId} {
        allow write: if request.auth.uid == seguidorId;
      }

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

Las reglas repiten las validaciones que ya tiene la app: la reseña no está vacía y tiene hasta 500 caracteres, es del usuario autenticado, es de un álbum, una canción o un artista, tiene una calificación entera de 0 a 5, una fecha `AAAA-MM-DD` y, si tiene ubicación, una latitud entre -90 y 90 y una longitud entre -180 y 180; un comentario no está vacío y tiene hasta 500 caracteres; los contadores de likes y comentarios nunca son negativos; cada usuario solo escribe sus propios likes (en reseñas, comentarios, álbumes, canciones y artistas), sus likes y guardados en su perfil y su lado del seguimiento (`following` en su documento y `followers` en el de quien sigue); el nombre, el usuario, la biografía y el Instagram respetan sus límites (40, 20, 150 y 30); las historias no se escriben desde la app; en los duelos los votos nunca son negativos, cada usuario solo escribe su propio voto (por `a` o por `b`) y la opinión tiene hasta 140 caracteres; una mixtape solo la crea, la cambia y la borra su dueño, con nombre de hasta 40, descripción de hasta 150, hasta 4 portadas e `itemsCount` nunca negativo, y cada item de su subcolección `items` es un álbum, una canción o un artista; y lo que está sonando solo lo pone y lo quita su dueño, quien reacciona deja `reaccionesCount` en un entero no negativo, cada usuario escribe solo su reacción y la borra él o el dueño. Las Cloud Functions escriben con el SDK de administrador, que no pasa por las reglas.

Hasta dónde llegan: una regla solo ve el documento que se escribe. En `mixtapes/{id}/items` el dueño está en el documento padre, así que la regla pide un usuario autenticado y un `tipo` válido, sin saber si quien escribe es el dueño de la mixtape. En `sonando/{uid}` no distingue qué campo cambió quien reacciona: basta con que el contador quede bien.

Storage se creó en **modo de prueba**, que vence a los 30 días: antes de la sustentación hay que revisar en *Storage → Reglas* que no haya vencido, o la subida de la foto de perfil falla por permisos.
