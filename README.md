# 🎬 Guion a Imágenes — generador de imágenes con IA para vídeos de YouTube

Pega el guion de tu vídeo y la app:

1. **Divide el guion en fragmentos de 3 a 5 palabras** (configurable), respetando frases y comas.
2. **Detecta los personajes** con IA y les da una descripción visual fija.
3. **Crea una imagen de referencia de cada personaje** y la envía a la IA en cada escena donde aparece, para que **siempre se vean iguales**.
4. **Genera una imagen por fragmento**, con el estilo visual que elijas.
5. Te deja **descargarlo todo en un ZIP**: imágenes numeradas (`001.png`, `002.png`...), un `escenas.csv` con tiempos y un `subtitulos.srt` para alinearlas en tu editor de vídeo.

Es una página web estática (HTML + JavaScript, sin servidor), así que funciona en **GitHub Pages** gratis.

---

## 🚀 Cómo usarla

### Opción A — En tu ordenador
Descarga el proyecto y abre `index.html` con doble clic en Chrome o Edge.

### Opción B — Publicarla en GitHub Pages
1. Crea un repositorio nuevo en GitHub (por ejemplo `generador-imagenes-youtube`).
2. Sube todos los archivos de esta carpeta (botón **Add file → Upload files**, o con git, ver abajo).
3. Ve a **Settings → Pages**, en *Source* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guarda.
4. En un par de minutos tendrás la app en `https://TU-USUARIO.github.io/generador-imagenes-youtube/`.

Subirla con git:

```bash
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/generador-imagenes-youtube.git
git push -u origin main
```

---

## 🔑 Proveedores de IA

Configúralos en la pestaña **⚙ Ajustes**.

| Proveedor | Clave | Consistencia de personajes | Notas |
|---|---|---|---|
| **Google Gemini** (recomendado) | [Google AI Studio](https://aistudio.google.com/apikey) | ✅ Alta — usa la imagen de referencia de cada personaje | Modelo por defecto `gemini-2.5-flash-image` |
| **OpenAI** | [platform.openai.com](https://platform.openai.com/api-keys) | ✅ Alta — usa referencias | Modelo por defecto `gpt-image-1` |
| **Pollinations** | [enter.pollinations.ai](https://enter.pollinations.ai) (gratis) | ⚠️ Básica — misma semilla + misma descripción | Muchos modelos (Flux, Seedream...) con un saldo gratuito |

Los nombres de los modelos se pueden cambiar en Ajustes si sale uno nuevo (por ejemplo, modelos de imagen de Gemini más recientes que `gemini-2.5-flash-image`).

> 🔒 Tus claves se guardan **solo en tu navegador** (localStorage) y se envían directamente a Google/OpenAI/Pollinations. No están en el código y nunca se suben a GitHub. Si publicas la app en GitHub Pages, cada persona que la use tendrá que poner su propia clave.

---

## 🧑‍🤝‍🧑 Cómo se mantiene la consistencia de los personajes

- Cada personaje tiene **nombre, alias** (ej. "el abuelo", "Don Pepe") y una **descripción visual fija** (pelo, ropa, colores...).
- La app busca el nombre o los alias en cada fragmento del guion (sin importar mayúsculas ni tildes).
- Si un fragmento habla de alguien sin nombrarlo ("y entonces **él** abrió la puerta"), **hereda los personajes del fragmento anterior** (se ve con borde discontinuo). Puedes desactivarlo.
- Puedes **activar o quitar personajes a mano** en cada escena pulsando sus etiquetas.
- Antes de generar las escenas se crea una **hoja de referencia** de cada personaje (o subes tu propia imagen), y esa imagen se adjunta a cada escena en la que aparece.

## ✨ Prompts de escena

Con el botón **"Crear prompts de escena con IA"**, la IA lee todo el guion y escribe para cada fragmento una descripción visual (plano, lugar, acción) manteniendo la continuidad de la historia. Puedes editarlas antes de generar. Si no lo usas, cada imagen se genera directamente a partir del texto del fragmento.

## 💡 Consejos

- 1 minuto de locución ≈ 150 palabras ≈ 35-40 imágenes. Un vídeo de 10 minutos puede ser **~400 imágenes**: revisa el precio de tu proveedor.
- Si alguna imagen falla (límite de peticiones), pulsa **Generar imágenes** otra vez: solo se reintentan las que faltan.
- El botón **↻ Generar** de cada tarjeta crea una variante nueva de esa escena.
- **Exportar proyecto** guarda guion, personajes e imágenes en un `.json` para continuar en otro ordenador.

## 📁 Estructura

```
index.html        Interfaz
css/styles.css    Estilos
js/splitter.js    División del guion y detección de personajes por fragmento
js/providers.js   Conexión con Gemini, OpenAI y Pollinations
js/storage.js     Guardado local (ajustes y proyecto)
js/app.js         Lógica principal
```

## Licencia

MIT
