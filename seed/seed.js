import admin from "firebase-admin";
import { fakerES_MX as faker } from "@faker-js/faker";
import catalogo from "./catalogo.json" with { type: "json" };
// Firebase real: descomentar este import y la linea credential, y comentar las dos del emulador
//import serviceAccount from "./serviceAccountKey.json" with { type: "json" };

// Emulador (Firebase CLI): las escrituras van al Firestore del emulador
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

admin.initializeApp({
  //credential: admin.credential.cert(serviceAccount),
  projectId: "mixtapp-720eb",
});

const db = admin.firestore();

// Siempre salen los mismos usuarios, likes y resenas: correr el seed otra vez deja la base igual
faker.seed(13);

const USUARIOS = 12;
const SIGUE_A = 4; // a cuantos usuarios sigue cada uno
const LIKES_POR_USUARIO = 8;
const RESENAS_POR_USUARIO = 4;
const MAX_COMENTARIOS_POR_RESENA = 3;
// Un batch acepta hasta 500 operaciones
const MAX_OPERACIONES_POR_BATCH = 500;
// Mismos limites que la app y las reglas
const MAX_NOMBRE = 40;
const MAX_USERNAME = 20;

// La coleccion de cada tipo de item
const COLECCIONES = { album: "albumes", cancion: "canciones", artista: "artistas" };

const BIOS = [
  "Escucho de todo, pero el rock siempre gana.",
  "Si tiene guitarras distorsionadas, me interesa.",
  "Perreo los viernes y despecho los domingos.",
  "Coleccionista de vinilos y de opiniones.",
  "Aqui escribo lo que pienso de cada disco que escucho.",
  "Metalero de corazon, abierto a recomendaciones.",
  "Un album completo, de principio a fin, sin saltar canciones.",
  "La musica popular tambien es poesia.",
];

const RESENAS = [
  "La produccion esta impecable, cada escucha le encuentro algo nuevo.",
  "No es lo mejor que han hecho, pero tiene momentos muy buenos.",
  "Lo escuche completo dos veces seguidas. Muy recomendado.",
  "Las letras pegan duro. Perfecto para el carro.",
  "Le falta fuerza en la segunda mitad, pero el comienzo es brutal.",
  "Un clasico que no envejece.",
  "Me sorprendio para bien, no esperaba tanto.",
  "Suena a lo de siempre, nada que no hayamos escuchado.",
  "Lo pongo cada vez que necesito energia.",
  "La voz es lo mejor de todo, sin duda.",
];

const COMENTARIOS = [
  "Totalmente de acuerdo.",
  "Yo le daria una estrella mas.",
  "La segunda mitad es mi parte favorita.",
  "No lo habia escuchado asi, le dare otra oportunidad.",
  "Que buena resena.",
  "Para mi es de lo mejor del genero.",
];

// Todos los items del catalogo en una sola lista, cada uno con su tipo
const items = [
  ...catalogo.albumes.map((album) => ({ ...album, tipo: "album" })),
  ...catalogo.canciones.map((cancion) => ({ ...cancion, tipo: "cancion" })),
  ...catalogo.artistas.map((artista) => ({ ...artista, tipo: "artista" })),
];
const generos = [...new Set(items.map((item) => item.genero))];

// Lo que la resena y el like del usuario copian del item, igual para los tres tipos
function copiaDelItem(item) {
  if (item.tipo === "artista") {
    return { titulo: item.nombre, subtitulo: item.grupo || item.genero, imagenUrl: item.fotoUrl };
  }
  return { titulo: item.titulo, subtitulo: item.artista, imagenUrl: item.portadaUrl };
}

function referenciaDelItem(item) {
  return db.collection(COLECCIONES[item.tipo]).doc(item.id);
}

// Sin tildes ni espacios y con el largo maximo de la app
function nombreDeUsuario(firstName, lastName) {
  return `${firstName}_${lastName}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX_USERNAME);
}

// La mayoria de los items salen del genero que prefiere el usuario, el resto de cualquiera
function itemsParaUsuario(usuario, cuantos) {
  const delGenero = items.filter((item) => item.genero === usuario.generoFavorito);
  const deSuGenero = faker.helpers.arrayElements(delGenero, Math.ceil(cuantos * 0.7));
  const otros = items.filter((item) => !deSuGenero.includes(item));

  return [...deSuGenero, ...faker.helpers.arrayElements(otros, cuantos - deSuGenero.length)];
}

// Hasta `maximo` usuarios distintos de los excluidos
function otrosUsuarios(usuarios, excluidos, maximo) {
  const candidatos = usuarios.filter((usuario) => !excluidos.includes(usuario.id));
  return faker.helpers.arrayElements(candidatos, { min: 0, max: maximo });
}

function buildUsuario(i) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  return {
    id: `usuario_${i}`,
    username: nombreDeUsuario(firstName, lastName),
    nombre: `${firstName} ${lastName}`.slice(0, MAX_NOMBRE),
    bio: faker.helpers.arrayElement(BIOS),
    fotoUrl: faker.image.personPortrait({ size: 256 }),
    // No se guarda: decide de que genero son sus likes y sus resenas
    generoFavorito: faker.helpers.arrayElement(generos),
  };
}

function armarEscrituras() {
  const ahora = new Date();
  // Cada escritura es { ref, datos }: al final se guardan todas de a 500. Las Cloud Functions
  // leen la resena y los usuarios cuando llega un like, un comentario o un seguidor, asi que
  // primero van el catalogo y los usuarios, despues las resenas con sus comentarios y al final
  // los likes y los seguidores
  const documentos = [];
  const resenas = [];
  const escrituras = [];
  const likesDeItem = new Map(); // id del item -> cuantos likes tiene
  const usuarios = Array.from({ length: USUARIOS }, (_, i) => buildUsuario(i + 1));
  const contadores = new Map(usuarios.map((usuario) => [usuario.id, { followers: 0, following: 0 }]));

  // Seguidores: following en quien sigue y followers en el seguido, como la transaccion de la app
  for (const usuario of usuarios) {
    const seguidos = faker.helpers.arrayElements(
      usuarios.filter((otro) => otro.id !== usuario.id),
      SIGUE_A
    );
    for (const seguido of seguidos) {
      const timestamp = admin.firestore.Timestamp.fromDate(faker.date.recent({ days: 60, refDate: ahora }));
      escrituras.push({
        ref: db.collection("usuarios").doc(usuario.id).collection("following").doc(seguido.id),
        datos: { timestamp },
      });
      escrituras.push({
        ref: db.collection("usuarios").doc(seguido.id).collection("followers").doc(usuario.id),
        datos: { timestamp },
      });
      contadores.get(usuario.id).following++;
      contadores.get(seguido.id).followers++;
    }
  }

  // Likes a items: el like en el item y la copia en usuarios/{uid}/likes, que alimenta los
  // favoritos y el For you
  for (const usuario of usuarios) {
    for (const item of itemsParaUsuario(usuario, LIKES_POR_USUARIO)) {
      const fecha = faker.date.recent({ days: 60, refDate: ahora });
      escrituras.push({
        ref: referenciaDelItem(item).collection("likes").doc(usuario.id),
        datos: { timestamp: admin.firestore.Timestamp.fromDate(fecha) },
      });
      escrituras.push({
        ref: db.collection("usuarios").doc(usuario.id).collection("likes").doc(item.id),
        datos: { tipo: item.tipo, ...copiaDelItem(item), genero: item.genero, createdAt: fecha.toISOString() },
      });
      likesDeItem.set(item.id, (likesDeItem.get(item.id) || 0) + 1);
    }
  }

  // Resenas con sus likes y su discusion. Los contadores salen de los documentos que se crean
  for (const usuario of usuarios) {
    itemsParaUsuario(usuario, RESENAS_POR_USUARIO).forEach((item, index) => {
      const reviewRef = db.collection("reviews").doc(`${usuario.id}_${index + 1}`); // ej: "usuario_1_2"
      const creada = faker.date.recent({ days: 60, refDate: ahora });
      const escuchada = faker.date.recent({ days: 10, refDate: creada });

      const quienesDieronLike = otrosUsuarios(usuarios, [usuario.id], 5);
      for (const otro of quienesDieronLike) {
        escrituras.push({
          ref: reviewRef.collection("likes").doc(otro.id),
          datos: { timestamp: admin.firestore.Timestamp.fromDate(faker.date.between({ from: creada, to: ahora })) },
        });
      }

      // Los comentarios son despues de la resena; la respuesta, despues del comentario que responde
      const comentaristas = otrosUsuarios(usuarios, [usuario.id], MAX_COMENTARIOS_POR_RESENA);
      const comentarios = comentaristas
        .map((autor) => ({ autor, fecha: faker.date.between({ from: creada, to: ahora }) }))
        .sort((a, b) => a.fecha - b.fecha);
      if (comentarios.length > 0 && faker.datatype.boolean()) {
        comentarios.push({
          autor: usuario,
          fecha: faker.date.between({ from: comentarios[0].fecha, to: ahora }),
          responde: "comentario_1",
        });
      }

      // Mismos nombres y tipos que el DTO de la app: si un campo cambia de nombre, toObject no lo lee
      resenas.push({
        ref: reviewRef,
        datos: {
          usuarioId: usuario.id,
          itemId: item.id,
          tipo: item.tipo,
          calificacion: item.genero === usuario.generoFavorito
            ? faker.number.int({ min: 3, max: 5 })
            : faker.number.int({ min: 1, max: 5 }),
          comentario: faker.helpers.arrayElement(RESENAS),
          fechaEscucha: escuchada.toISOString().slice(0, 10), // "YYYY-MM-DD"
          createdAt: creada.toISOString(),
          updatedAt: creada.toISOString(),
          likesCount: quienesDieronLike.length,
          commentsCount: comentarios.length,
          usuario: { nombre: usuario.nombre, fotoUrl: usuario.fotoUrl },
          item: copiaDelItem(item),
        },
      });

      comentarios.forEach((comentario, c) => {
        const comentarioRef = reviewRef.collection("comments").doc(`comentario_${c + 1}`);
        const likesDelComentario = otrosUsuarios(usuarios, [comentario.autor.id], 3);
        resenas.push({
          ref: comentarioRef,
          datos: {
            usuarioId: comentario.autor.id,
            contenido: faker.helpers.arrayElement(COMENTARIOS),
            parentCommentId: comentario.responde || null,
            likesCount: likesDelComentario.length,
            createdAt: comentario.fecha.toISOString(),
            usuario: { nombre: comentario.autor.nombre, fotoUrl: comentario.autor.fotoUrl },
          },
        });
        for (const otro of likesDelComentario) {
          escrituras.push({
            ref: comentarioRef.collection("likes").doc(otro.id),
            datos: { timestamp: admin.firestore.Timestamp.fromDate(comentario.fecha) },
          });
        }
      });
    });
  }

  // Los usuarios, con los contadores que coinciden con sus subcolecciones. El id va como nombre
  // del documento y no dentro de los campos, como lo deja la app
  for (const usuario of usuarios) {
    const { id, generoFavorito, ...datos } = usuario;
    documentos.push({
      ref: db.collection("usuarios").doc(id),
      datos: {
        ...datos,
        followersCount: contadores.get(id).followers,
        followingCount: contadores.get(id).following,
        // Sin celular: la Cloud Function no les envia push
        fcmtoken: null,
      },
    });
  }

  // El catalogo real, con cuantos likes le dieron los usuarios
  for (const item of items) {
    const { id, tipo, ...datos } = item;
    documentos.push({
      ref: referenciaDelItem(item),
      datos: {
        ...datos,
        likesCount: likesDeItem.get(id) || 0,
        createdAt: ahora.toISOString(),
        updatedAt: ahora.toISOString(),
      },
    });
  }

  return [...documentos, ...resenas, ...escrituras];
}

// Se guardan de a 500 por batch
async function guardarPorLotes(escrituras) {
  for (let inicio = 0; inicio < escrituras.length; inicio += MAX_OPERACIONES_POR_BATCH) {
    const batch = db.batch();
    escrituras
      .slice(inicio, inicio + MAX_OPERACIONES_POR_BATCH)
      .forEach(({ ref, datos }) => batch.set(ref, datos));
    await batch.commit();
    console.log(`  ${Math.min(inicio + MAX_OPERACIONES_POR_BATCH, escrituras.length)} de ${escrituras.length}`);
  }
}

try {
  const escrituras = armarEscrituras();
  console.log(
    `Seeding ${catalogo.albumes.length} albumes, ${catalogo.canciones.length} canciones, ` +
      `${catalogo.artistas.length} artistas y ${USUARIOS} usuarios con sus likes, resenas y comentarios...`
  );
  await guardarPorLotes(escrituras);
  console.log("Seeding completed!");
  process.exit(0);
} catch (error) {
  // Si no se imprime el error nunca se sabe que esta mal
  console.error("Error seeding data:", error);
  process.exit(1);
}
