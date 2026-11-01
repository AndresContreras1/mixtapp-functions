# Catálogo y datos falsos

`seed.js` llena Firestore para ver la app como si tuviera usuarios:

- **El catálogo real** de `catalogo.json`: 24 álbumes, 46 canciones y 21 artistas de rock, metal,
  reggaetón y música popular, con portadas y fotos de 1000 px, género y subgénero, de 3 a 5 datos
  curiosos y la posición en el Top Colombia de Deezer del 31 de octubre de 2026 (`tendencia`,
  `null` si no está en el top).
- **12 usuarios de [Faker](https://fakerjs.dev/)**, con nombres en español y foto. Cada uno sigue a
  4 usuarios, le da like a 8 items y escribe 4 reseñas, casi todo del género que prefiere. Las
  reseñas traen likes y una discusión con comentarios, respuestas y likes de otros usuarios.

Los contadores (`followersCount`, `likesCount`, `commentsCount`…) salen de los documentos que se
crean en cada subcolección, así que siempre coinciden. `faker.seed(13)` hace que salgan siempre los
mismos datos: correr el seed otra vez deja la base igual.

Los campos tienen los mismos nombres y tipos que los DTO de la app; si uno cambia, `toObject` no lo
lee. Estos datos son para mostrar la app, **no para las pruebas**: las pruebas de integración crean
y borran sus propios datos.

## Instalar

Hace falta Node.js.

```bash
cd seed
npm install
```

## Contra el emulador (Firebase CLI)

Es la configuración que trae `seed.js`: escribe en el Firestore del emulador (`localhost:8080`).

1. En la carpeta raíz de `mixtapp-functions`:
   `firebase emulators:start --only firestore,auth --project mixtapp-720eb`
2. En otra terminal, dentro de `seed`: `node seed.js`

Los datos aparecen en `http://127.0.0.1:4000/firestore` y se borran al cerrar la CLI.

## Contra el Firebase real

1. Consola de Firebase → **Configuración del proyecto → Cuentas de servicio → Node.js → Generar
   nueva clave privada**. Guardar el archivo en esta carpeta como `serviceAccountKey.json` (está en
   el `.gitignore`: nunca se sube a GitHub).
2. En `seed.js`, descomentar el `import` de `serviceAccountKey.json` y la línea `credential`, y
   comentar las líneas del emulador (`FIRESTORE_EMULATOR_HOST` y `projectId`).
3. Si la base tiene los datos de antes (álbumes `album_1` a `album_15` y reseñas con `albumId`),
   borrarlos primero en la consola: **Firestore Database → la colección → ⋮ → Eliminar colección**,
   con `albumes`, `reviews` y `usuarios`. Las cuentas de Authentication no se borran: al iniciar
   sesión, la app vuelve a crear el documento del usuario.
4. Correr `node seed.js`.

Cada escritura cuenta para la capa gratuita: son unas 760. Un `batch` acepta hasta 500 operaciones,
así que se guardan en dos lotes. Con las Cloud Functions publicadas, cada like, comentario y
seguidor del seed también crea su notificación.
