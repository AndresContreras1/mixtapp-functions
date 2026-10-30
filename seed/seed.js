import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" with { type: "json" };
import { faker } from "@faker-js/faker";

// Firebase real: credencial de la cuenta de servicio.
// Emulador (Firebase CLI): comentar credential, descomentar projectId y antes de correr el script
// poner en PowerShell $env:FIRESTORE_EMULATOR_HOST="localhost:8080"
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  //projectId: "mixtapp-720eb",
});

const db = admin.firestore();

// Mismos nombres y tipos que los DTO de la app: si un campo cambia de nombre, toObject no lo lee
function buildUsuario(i) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;

  return {
    id: `usuario_${i}`,
    username,
    nombre: `${firstName} ${lastName}`,
    bio: faker.lorem.sentence(),
    fotoUrl: faker.image.urlPicsumPhotos({ width: 200, height: 200 }),
    // Sin seguidores: las subcolecciones followers y following empiezan vacias y los contadores
    // tienen que coincidir con ellas
    followersCount: 0,
    followingCount: 0,
    // Sin celular: la Cloud Function no les envia notificaciones
    fcmtoken: null,
  };
}

function buildAlbum(i) {
  const nowIso = new Date().toISOString();

  return {
    id: `album_${i}`,
    titulo: faker.music.album(),
    artista: faker.music.artist(),
    portadaUrl: faker.image.urlPicsumPhotos({ width: 600, height: 600 }),
    anio: faker.number.int({ min: 1965, max: 2025 }),
    genero: faker.music.genre(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// La resena guarda la copia del usuario y del album que se muestra, como en la app
function buildReview(usuario, album, i, comentarios) {
  const nowIso = new Date().toISOString();
  const fechaEscucha = faker.date.recent({ days: 90 });

  return {
    id: `${usuario.id}_${i}`, // ej: "usuario_1_2"
    usuarioId: usuario.id,
    albumId: album.id,
    calificacion: faker.number.int({ min: 1, max: 5 }),
    comentario: faker.lorem.sentences({ min: 1, max: 3 }),
    fechaEscucha: fechaEscucha.toISOString().slice(0, 10), // "YYYY-MM-DD"
    likesCount: faker.number.int({ min: 0, max: 50 }),
    // Coincide con los comentarios que se crean en su subcoleccion
    commentsCount: comentarios,
    createdAt: nowIso,
    updatedAt: nowIso,
    usuario: {
      nombre: usuario.nombre,
      fotoUrl: usuario.fotoUrl,
    },
    album: {
      titulo: album.titulo,
      artista: album.artista,
      portadaUrl: album.portadaUrl,
    },
  };
}

function buildComentario(usuario, i) {
  return {
    id: `comentario_${i}`,
    usuarioId: usuario.id,
    contenido: faker.lorem.sentence({ min: 4, max: 20 }),
    parentCommentId: null,
    likesCount: faker.number.int({ min: 0, max: 10 }),
    createdAt: faker.date.recent({ days: 30 }).toISOString(),
    usuario: {
      nombre: usuario.nombre,
      fotoUrl: usuario.fotoUrl,
    },
  };
}

async function seedUsuarios(count = 10) {
  const batch = db.batch();
  const usuarios = [];

  for (let i = 1; i <= count; i++) {
    const usuario = buildUsuario(i);
    usuarios.push(usuario);

    // El id va como nombre del documento y no dentro de los campos, como lo deja la app
    const { id, ...datos } = usuario;
    batch.set(db.collection("usuarios").doc(id), datos);
  }

  await batch.commit();

  return usuarios;
}

async function seedAlbumes(count = 15) {
  const batch = db.batch();
  const albumes = [];

  for (let i = 1; i <= count; i++) {
    const album = buildAlbum(i);
    albumes.push(album);

    const { id, ...datos } = album;
    batch.set(db.collection("albumes").doc(id), datos);
  }

  await batch.commit();

  return albumes;
}

// Cada usuario resena albumes distintos, y cada resena trae comentarios de otros usuarios.
// Un batch maneja hasta 500 operaciones: con los numeros de abajo son menos de 100
async function seedReviews(usuarios, albumes, reviewsPerUsuario = 3, comentariosPerReview = 2) {
  const batch = db.batch();

  for (const usuario of usuarios) {
    const albumesResenados = faker.helpers.arrayElements(albumes, reviewsPerUsuario);

    albumesResenados.forEach((album, index) => {
      const review = buildReview(usuario, album, index + 1, comentariosPerReview);
      const { id, ...datos } = review;
      const reviewRef = db.collection("reviews").doc(id);
      batch.set(reviewRef, datos);

      for (let c = 1; c <= comentariosPerReview; c++) {
        const autor = faker.helpers.arrayElement(usuarios.filter((u) => u.id !== usuario.id));
        const comentario = buildComentario(autor, c);
        const { id: comentarioId, ...datosComentario } = comentario;
        batch.set(reviewRef.collection("comments").doc(comentarioId), datosComentario);
      }
    });
  }

  await batch.commit();
}

async function main() {
  try {
    console.log("Seeding usuarios...");
    const usuarios = await seedUsuarios(10);
    console.log("Seeding albumes...");
    const albumes = await seedAlbumes(15);
    console.log("Seeding reviews y comentarios...");
    await seedReviews(usuarios, albumes, 3, 2);
    console.log("Seeding completed!");
    process.exit(0);
  } catch (error) {
    // Si no se imprime el error nunca se sabe que esta mal
    console.error("Error seeding data:", error);
    process.exit(1);
  }
}

main();
