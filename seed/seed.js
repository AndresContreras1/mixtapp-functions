import admin from "firebase-admin";
import { fakerES_MX as faker } from "@faker-js/faker";
import catalogo from "./catalogo.json" with { type: "json" };
// Los datos curiosos de cada item, por secciones: van en su propia coleccion
import historias from "./historias.json" with { type: "json" };
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

const USUARIOS = 20;
const SIGUE_A = 4; // a cuantos usuarios sigue cada uno
const LIKES_POR_USUARIO = 8;
const RESENAS_POR_USUARIO = 4;
// La primera resena de cada usuario es de las ultimas 24 horas y tiene ubicacion: asi el mapa de la
// app tiene marcadores. Se reparten entre estas ciudades, con unas cuadras de diferencia
const CIUDADES = [
  { latitud: 4.6533, longitud: -74.0836 }, // Bogota
  { latitud: 6.2442, longitud: -75.5812 }, // Medellin
  { latitud: 3.4516, longitud: -76.532 }, // Cali
  { latitud: 10.9685, longitud: -74.7813 }, // Barranquilla
  { latitud: 7.1193, longitud: -73.1227 }, // Bucaramanga
];
const DESVIO_EN_GRADOS = 0.03;
const MAX_COMENTARIOS_POR_RESENA = 3;
// Un batch acepta hasta 500 operaciones
const MAX_OPERACIONES_POR_BATCH = 500;
// node seed.js --solo-tendencias: solo cambia tendencia y tendenciaColombia en los documentos del
// catalogo que ya existen, sin tocar usuarios, likes ni resenas. Es para el Firebase real, que ya
// tiene lo que hicieron los usuarios de la app
const SOLO_TENDENCIAS = process.argv.includes("--solo-tendencias");
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
  const username = nombreDeUsuario(firstName, lastName);

  return {
    id: `usuario_${i}`,
    username,
    nombre: `${firstName} ${lastName}`.slice(0, MAX_NOMBRE),
    bio: faker.helpers.arrayElement(BIOS),
    fotoUrl: faker.image.personPortrait({ size: 256 }),
    // Casi todos ponen su Instagram; es el mismo nombre de usuario, sin la @
    instagram: faker.datatype.boolean({ probability: 0.7 }) ? username : null,
    // No se guarda: decide de que genero son sus likes y sus resenas
    generoFavorito: faker.helpers.arrayElement(generos),
  };
}

// Los likes y los seguidores solo guardan la fecha, como la transaccion de la app
function escrituraConFecha(ref, fecha) {
  return { ref, datos: { timestamp: admin.firestore.Timestamp.fromDate(fecha) } };
}

// Unas cuadras de diferencia alrededor de la ciudad
function desvio() {
  return faker.number.float({ min: -DESVIO_EN_GRADOS, max: DESVIO_EN_GRADOS });
}

// Seguidores: following en quien sigue y followers en el seguido, como la transaccion de la app.
// Suma en `contadores` a cuantos sigue cada usuario y cuantos lo siguen
function armarSeguidores(usuarios, contadores, ahora) {
  const escrituras = [];
  for (const usuario of usuarios) {
    const seguidos = faker.helpers.arrayElements(
      usuarios.filter((otro) => otro.id !== usuario.id),
      SIGUE_A
    );
    for (const seguido of seguidos) {
      const fecha = faker.date.recent({ days: 60, refDate: ahora });
      const followingRef = db.collection("usuarios").doc(usuario.id).collection("following").doc(seguido.id);
      const followersRef = db.collection("usuarios").doc(seguido.id).collection("followers").doc(usuario.id);
      escrituras.push(escrituraConFecha(followingRef, fecha), escrituraConFecha(followersRef, fecha));
      contadores.get(usuario.id).following++;
      contadores.get(seguido.id).followers++;
    }
  }
  return escrituras;
}

// Likes a items: el like en el item y la copia en usuarios/{uid}/likes, que alimenta los
// favoritos y el For you. Suma en `likesDeItem` cuantos likes recibe cada item
function armarLikes(usuarios, likesDeItem, ahora) {
  const escrituras = [];
  for (const usuario of usuarios) {
    for (const item of itemsParaUsuario(usuario, LIKES_POR_USUARIO)) {
      const fecha = faker.date.recent({ days: 60, refDate: ahora });
      escrituras.push(escrituraConFecha(referenciaDelItem(item).collection("likes").doc(usuario.id), fecha));
      escrituras.push({
        ref: db.collection("usuarios").doc(usuario.id).collection("likes").doc(item.id),
        datos: { tipo: item.tipo, ...copiaDelItem(item), genero: item.genero, createdAt: fecha.toISOString() },
      });
      likesDeItem.set(item.id, (likesDeItem.get(item.id) || 0) + 1);
    }
  }
  return escrituras;
}

// Los comentarios de una resena, del mas viejo al mas nuevo: son despues de la resena y, a veces,
// su autor responde al primero
function armarDiscusion(autor, usuarios, creada, ahora) {
  const comentaristas = otrosUsuarios(usuarios, [autor.id], MAX_COMENTARIOS_POR_RESENA);
  const comentarios = comentaristas
    .map((comentarista) => ({ autor: comentarista, fecha: faker.date.between({ from: creada, to: ahora }) }))
    .sort((a, b) => a.fecha - b.fecha);
  if (comentarios.length > 0 && faker.datatype.boolean()) {
    comentarios.push({
      autor,
      fecha: faker.date.between({ from: comentarios[0].fecha, to: ahora }),
      responde: "comentario_1",
    });
  }
  return comentarios;
}

// Mismos nombres y tipos que el DTO de la app: si un campo cambia de nombre, toObject no lo lee.
// Solo la resena que va en el mapa trae `ciudad`; las demas quedan sin ubicacion
function buildResena(usuario, item, { creada, escuchada, ciudad, likesCount, commentsCount }) {
  return {
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
    likesCount,
    commentsCount,
    usuario: { nombre: usuario.nombre, fotoUrl: usuario.fotoUrl },
    item: copiaDelItem(item),
    // Donde se publico
    latitud: ciudad ? ciudad.latitud + desvio() : null,
    longitud: ciudad ? ciudad.longitud + desvio() : null,
  };
}

// Un comentario de la discusion; si es una respuesta, parentCommentId es el comentario que responde
function buildComentario(comentario, likesCount) {
  return {
    usuarioId: comentario.autor.id,
    contenido: faker.helpers.arrayElement(COMENTARIOS),
    parentCommentId: comentario.responde || null,
    likesCount,
    createdAt: comentario.fecha.toISOString(),
    usuario: { nombre: comentario.autor.nombre, fotoUrl: comentario.autor.fotoUrl },
  };
}

// Una resena con sus likes y su discusion; los contadores salen de los documentos que se crean.
// `documentos` trae la resena y sus comentarios, y `likes` los likes de los dos
function armarResena(usuario, item, index, usuarios, ahora) {
  const documentos = [];
  const likes = [];
  const reviewRef = db.collection("reviews").doc(`${usuario.id}_${index + 1}`); // ej: "usuario_1_2"
  const enElMapa = index === 0;
  const creada = enElMapa
    ? faker.date.recent({ days: 1, refDate: ahora })
    : faker.date.recent({ days: 60, refDate: ahora });
  const escuchada = faker.date.recent({ days: 10, refDate: creada });

  const quienesDieronLike = otrosUsuarios(usuarios, [usuario.id], 5);
  for (const otro of quienesDieronLike) {
    const fecha = faker.date.between({ from: creada, to: ahora });
    likes.push(escrituraConFecha(reviewRef.collection("likes").doc(otro.id), fecha));
  }

  const comentarios = armarDiscusion(usuario, usuarios, creada, ahora);
  documentos.push({
    ref: reviewRef,
    datos: buildResena(usuario, item, {
      creada,
      escuchada,
      ciudad: enElMapa ? CIUDADES[usuarios.indexOf(usuario) % CIUDADES.length] : null,
      likesCount: quienesDieronLike.length,
      commentsCount: comentarios.length,
    }),
  });

  comentarios.forEach((comentario, posicion) => {
    const comentarioRef = reviewRef.collection("comments").doc(`comentario_${posicion + 1}`);
    const likesDelComentario = otrosUsuarios(usuarios, [comentario.autor.id], 3);
    documentos.push({ ref: comentarioRef, datos: buildComentario(comentario, likesDelComentario.length) });
    for (const otro of likesDelComentario) {
      likes.push(escrituraConFecha(comentarioRef.collection("likes").doc(otro.id), comentario.fecha));
    }
  });

  return { documentos, likes };
}

// Las resenas de todos los usuarios, casi todas de su genero favorito
function armarResenas(usuarios, ahora) {
  const documentos = [];
  const likes = [];
  for (const usuario of usuarios) {
    itemsParaUsuario(usuario, RESENAS_POR_USUARIO).forEach((item, index) => {
      const resena = armarResena(usuario, item, index, usuarios, ahora);
      documentos.push(...resena.documentos);
      likes.push(...resena.likes);
    });
  }
  return { documentos, likes };
}

// Los usuarios, con los contadores que coinciden con sus subcolecciones. El id va como nombre del
// documento y no dentro de los campos, como lo deja la app
function armarUsuarios(usuarios, contadores) {
  return usuarios.map((usuario) => {
    const { id, generoFavorito, ...datos } = usuario;
    return {
      ref: db.collection("usuarios").doc(id),
      datos: {
        ...datos,
        followersCount: contadores.get(id).followers,
        followingCount: contadores.get(id).following,
        // Sin celular: la Cloud Function no les envia push
        fcmtoken: null,
      },
    };
  });
}

// El catalogo real, con cuantos likes le dieron los usuarios
function armarCatalogo(likesDeItem, ahora) {
  return items.map((item) => {
    const { id, tipo, ...datos } = item;
    return {
      ref: referenciaDelItem(item),
      datos: {
        ...datos,
        likesCount: likesDeItem.get(id) || 0,
        createdAt: ahora.toISOString(),
        updatedAt: ahora.toISOString(),
      },
    };
  });
}

// Las historias de cada item, con el mismo id: la app las lee solo al abrir Datos curiosos
function armarHistorias() {
  const documentos = [];
  for (const [itemId, historia] of Object.entries(historias)) {
    documentos.push({
      ref: db.collection("historias").doc(itemId),
      datos: { tipo: historia.tipo, secciones: historia.secciones },
    });
  }
  return documentos;
}

// Todo el seed completo. Cada escritura es { ref, datos }: al final se guardan todas de a 500. Las
// Cloud Functions leen la resena y los usuarios cuando llega un like, un comentario o un
// seguidor, asi que primero van los usuarios y el catalogo, despues las resenas con sus
// comentarios y al final los likes y los seguidores
function armarEscrituras() {
  const ahora = new Date();
  const usuarios = Array.from({ length: USUARIOS }, (_, i) => buildUsuario(i + 1));
  const contadores = new Map(usuarios.map((usuario) => [usuario.id, { followers: 0, following: 0 }]));
  const likesDeItem = new Map(); // id del item -> cuantos likes tiene

  // Faker se llama siempre en este orden: con faker.seed(13) salen los mismos datos
  const seguidores = armarSeguidores(usuarios, contadores, ahora);
  const likes = armarLikes(usuarios, likesDeItem, ahora);
  const resenas = armarResenas(usuarios, ahora);

  return [
    ...armarUsuarios(usuarios, contadores),
    ...armarCatalogo(likesDeItem, ahora),
    ...armarHistorias(),
    ...resenas.documentos,
    ...seguidores,
    ...likes,
    ...resenas.likes,
  ];
}

// Las dos tendencias de cada item del catalogo, para actualizarlas con update
function escriturasDeTendencias() {
  return items.map((item) => ({
    ref: referenciaDelItem(item),
    datos: { tendencia: item.tendencia, tendenciaColombia: item.tendenciaColombia },
  }));
}

// Se guardan de a 500 por batch. Con update solo cambian esos campos, y falla si el documento no
// existe (en ese caso hay que correr el seed completo)
async function guardarPorLotes(escrituras, soloActualizar) {
  for (let inicio = 0; inicio < escrituras.length; inicio += MAX_OPERACIONES_POR_BATCH) {
    const batch = db.batch();
    escrituras
      .slice(inicio, inicio + MAX_OPERACIONES_POR_BATCH)
      .forEach(({ ref, datos }) => (soloActualizar ? batch.update(ref, datos) : batch.set(ref, datos)));
    await batch.commit();
    console.log(`  ${Math.min(inicio + MAX_OPERACIONES_POR_BATCH, escrituras.length)} de ${escrituras.length}`);
  }
}

// main llama todo dentro de try/catch: si no se imprime el error nunca se sabe que esta mal
async function main() {
  try {
    if (SOLO_TENDENCIAS) {
      console.log(`Actualizando las tendencias de ${items.length} items del catalogo...`);
      await guardarPorLotes(escriturasDeTendencias(), true);
      console.log("Tendencias actualizadas!");
      process.exit(0);
    }

    const escrituras = armarEscrituras();
    console.log(
      `Seeding ${catalogo.albumes.length} albumes, ${catalogo.canciones.length} canciones, ` +
        `${catalogo.artistas.length} artistas, ${Object.keys(historias).length} historias y ${USUARIOS} usuarios ` +
        "con sus likes, resenas y comentarios..."
    );
    await guardarPorLotes(escrituras, false);
    console.log("Seeding completed!");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding data:", error);
    process.exit(1);
  }
}

main();
