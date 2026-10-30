# Datos falsos con Faker

`seed.js` llena Firestore con datos de [Faker](https://fakerjs.dev/) para ver la app como si
tuviera usuarios: 10 usuarios, 15 álbumes, 3 reseñas por usuario y 2 comentarios por reseña. Los
campos tienen los mismos nombres y tipos que los DTO de la app; si uno cambia, `toObject` no lo lee.

Estos datos son para mostrar la app, **no para las pruebas**: las pruebas de integración crean y
borran sus propios datos.

## Instalar

Hace falta Node.js.

```bash
cd seed
npm install
```

## Contra el emulador (Firebase CLI)

1. En la carpeta raíz de `mixtapp-functions`:
   `firebase emulators:start --only firestore,auth --project mixtapp-720eb`
2. En `seed.js`, comentar la línea `credential` y descomentar `projectId`.
3. En otra terminal (PowerShell), dentro de `seed`:

```powershell
$env:FIRESTORE_EMULATOR_HOST="localhost:8080"
node seed.js
```

Los datos aparecen en `http://127.0.0.1:4000/firestore` y se borran al cerrar la CLI.

## Contra el Firebase real

1. Consola de Firebase → **Configuración del proyecto → Cuentas de servicio → Node.js → Generar
   nueva clave privada**. Guardar el archivo en esta carpeta como `serviceAccountKey.json` (está en
   el `.gitignore`: nunca se sube a GitHub).
2. En `seed.js`, dejar la línea `credential` y comentar `projectId`.
3. Abrir una terminal nueva (sin `FIRESTORE_EMULATOR_HOST`) y correr `node seed.js`.

Cada escritura cuenta para la capa gratuita: los números son bajos a propósito. Un `batch` acepta
hasta 500 operaciones y aquí se usan menos de 100 por lote.

El `import` de `serviceAccountKey.json` está siempre activo, así que el archivo tiene que existir
también para correr contra el emulador.
