# Tempxral — Cómo ponerlo en marcha (paso a paso, sin experiencia previa)

He dejado todo construido, probado y automatizado al máximo. Hay un archivo, `render.yaml`,
que le dice a Render exactamente qué crear (el servidor, la base de datos, el espacio para
las imágenes) para que tú no tengas que rellenar nada a mano. Solo hay **4 pasos**, y los tres
primeros son crear cuentas y pulsar botones.

Importante y honesto: hay dos cosas que **solo tú puedes hacer**, porque son cuentas y pagos
personales tuyos y no algo a lo que yo pueda o deba tener acceso: crear las cuentas, y añadir
una tarjeta en Render. Todo lo demás (el código, la configuración, las pruebas) ya está hecho.

## Coste real (para que no haya sorpresas)

Para que la web funcione **de verdad como está pensada** — imágenes que no se pierden nunca,
sin pantallas de carga raras la primera vez que alguien entra — el coste mínimo honesto es
de **unos 13-14 €/mes** (servidor + base de datos + almacenamiento). Existe una opción 100%
gratuita, pero con una trampa seria: la base de datos gratuita de Render **se borra sola a
los 30 días**, y perderías todas las cuentas y publicaciones. Solo la recomiendo para probarlo
un par de semanas antes de decidirte. Te explico las dos abajo.

---

## Paso 1 — Sube el código a GitHub (sin usar la terminal)

1. Ve a github.com y crea una cuenta gratis (si no tienes).
2. Arriba a la derecha, pulsa el **+** → **New repository**.
3. Nombre: `tempxral`. Puede ser **Private**. Pulsa **Create repository**.
4. En la página del repositorio vacío, busca el enlace que dice algo como
   **"uploading an existing file"** y pulsa ahí.
5. Descomprime el archivo `tempxral-app.zip` que te di en tu ordenador. Abre esa carpeta,
   selecciona **todo su contenido** (no la carpeta en sí, lo de dentro) y arrástralo a la
   página de GitHub.
6. Abajo, pulsa **Commit changes**.

Ya tienes el código en GitHub. No has tenido que escribir ni un comando.

## Paso 2 — Crea tu cuenta en Render y añade el pago

1. Ve a render.com → **Get Started** → entra con tu cuenta de GitHub
   (un clic, sin contraseña nueva que recordar).
2. En **Account Settings → Billing**, añade una tarjeta. Esto es necesario para el plan de
   pago mínimo (~13-14 €/mes); si prefieres probarlo gratis antes, puedes saltarte esto por
   ahora e ir a la opción "modo gratis" más abajo.

## Paso 3 — Despliega con un clic (Blueprint)

1. En el panel de Render, pulsa **New +** → **Blueprint**.
2. Conecta y selecciona tu repositorio `tempxral`.
3. Render lee automáticamente el archivo `render.yaml` y te muestra lo que va a crear:
   el servidor web, la base de datos, y el espacio para las imágenes. No tienes que rellenar
   ninguna variable a mano — el archivo ya lo define todo, incluida una contraseña de
   seguridad generada al azar.
4. Pulsa **Apply**. Espera 2-5 minutos mientras Render construye todo.

## Paso 4 — Pruébalo

Cuando termine, Render te da una URL parecida a `https://tempxral.onrender.com`. Ábrela,
regístrate, sube una imagen, prueba los votos y el botón de ampliar tiempo. Ya está en un
servidor de verdad, con base de datos de verdad.

Cuando quieras, este es también el momento de escribirme para conectar tu propio dominio
(`tempxral.com` o el que elijas) — es un paso aparte, corto, y te lo dejo listo cuando lo
tengas comprado.

---

## Si prefieres probarlo gratis primero (sin tarjeta)

Puedes saltarte el paso de la tarjeta y, en el Paso 3, antes de pulsar "Apply", cambiar dos
líneas en `render.yaml`: donde dice `plan: starter` pon `plan: free`, y donde dice
`plan: basic-256mb` (dentro de `databases`) pon `plan: free`, y quita el bloque `disk:`
entero (el plan gratis no admite disco). Puedes editar ese archivo directamente en GitHub
(ábrelo, pulsa el lápiz de editar, cambia esas líneas, "Commit changes") antes de crear el
Blueprint. Así verás la web funcionando sin gastar nada — pero recuerda: a los 30 días la
base de datos gratuita desaparece sola, con todo lo que haya dentro. Si en algún momento
decides que sí quieres que sea permanente, dímelo y te preparo el cambio a la versión de
pago sin perder lo que ya tengas.

---

## Y si te atascas en cualquier paso

Dime exactamente qué ves en la pantalla (o pégame el mensaje de error) y seguimos desde ahí.
No hace falta que sepas de qué se trata el error — para eso estoy.

## Activar la moderación automática de imágenes

Por defecto está **desactivada** (para no romper nada antes de que decidas un proveedor).
Cuando quieras activarla:

1. Crea una cuenta en [sightengine.com](https://sightengine.com) (tiene plan de pruebas gratuito).
2. Copia tu "API User" y "API Secret" desde su panel.
3. En Render, entra en tu servicio → **Environment** → añade/edita:
   - `MODERATION_ENABLED` = `true`
   - `SIGHTENGINE_API_USER` = el que copiaste
   - `SIGHTENGINE_API_SECRET` = el que copiaste
4. Guarda — Render redesplegará solo con la moderación activa.

Recuerda: esto filtra desnudez/contenido explícito en general, pero **no es una herramienta de
detección de material de abuso infantil (CSAM)**. Si vas a alojar contenido para adultos en
abierto, además de esto necesitas solicitar acceso a un programa específico para eso, como
Thorn Safer o Microsoft PhotoDNA — muchos ofrecen acceso gratuito a plataformas pequeñas
precisamente por ser una prioridad de protección infantil.
