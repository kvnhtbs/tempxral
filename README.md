# Tempxral

El contenido se desvanece con el tiempo — nunca se borra del servidor.

## Qué es esto

Backend real (Node.js + Express + PostgreSQL) y frontend estático que implementan:

- Registro/login con contraseñas cifradas (bcrypt) y sesión por cookie JWT httpOnly
- Subida de imágenes (redimensionadas automáticamente con `sharp`)
- El contenido nunca se elimina: al expirar, deja de mostrarse pero sigue en el servidor
- Like/dislike por usuario, con el total sumado visible en cada publicación
- Ampliar el tiempo de vida +24h, limitado a una vez por usuario y día (aplicado en el servidor, no solo en el navegador)
- Reportar contenido inapropiado, con auto-ocultado tras varios reportes
- Visitantes ven todo; interactuar sin cuenta invita a registrarse
- Diseño responsivo (móvil y escritorio)

Probado de extremo a extremo contra una base de datos PostgreSQL real antes de entregarlo.

## Para desplegarlo

Sigue **`DEPLOY.md`** paso a paso — está pensado para alguien que no ha desplegado nunca un backend, usando Render.com.

## Para seguir construyendo

**`tempxral-arquitectura.md`** cubre lo que viene después: soporte de vídeo, panel de moderación humana, escalado con CDN, e implicaciones de RGPD.

## Estructura del proyecto

```
server.js              # arranque del servidor
src/
  db.js                # conexión a PostgreSQL
  auth.js              # JWT, cookies, middlewares de autenticación
  resizeImage.js        # redimensionado de imágenes subidas
  routes/
    auth.js            # /api/auth/*
    items.js           # /api/items/* (listar, subir, votar, ampliar, reportar)
sql/schema.sql         # esquema de base de datos
scripts/migrate.js     # aplica sql/schema.sql
public/                # frontend estático (index.html, styles.css, app.js)
uploads/               # imágenes subidas (en producción, usa un disco persistente)
```
