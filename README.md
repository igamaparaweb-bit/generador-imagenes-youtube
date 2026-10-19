# 🎬 Guion a Prompts — personajes y prompts para tus vídeos de YouTube

Pega el guion de tu vídeo y la app:

1. **Lo divide en escenas de 3 a 4 palabras** (configurable), respetando frases y comas. Cada escena será una imagen.
2. **Saca los personajes** (con IA o a mano) y les da una **descripción visual fija**.
3. **Escribe un prompt para cada escena** con el estilo elegido y la descripción de los personajes que aparecen, para que salgan siempre iguales.
4. Te deja **copiar todos los prompts** (uno por línea) o descargarlos en `.txt` / `.csv` (con tiempos).

**No genera imágenes.** Los prompts están pensados para pegarlos en Google Flow, o en la extensión *Google Flow Generador Masivo* (modo "Prompts").

Es una página web estática (HTML + JavaScript), publicada con GitHub Pages:
👉 https://igamaparaweb-bit.github.io/generador-imagenes-youtube/

---

## 🚀 Cómo se usa

1. **Guion**: pega el texto y pulsa **✂ Dividir guion en escenas**.
2. **Personajes**: pulsa **🔍 Detectar con IA** o **＋ Añadir personaje**. Escribe para cada uno:
   - **Nombre** (como aparece en el guion)
   - **Alias** (otras formas de llamarlo: "el abuelo", "Don Pepe")
   - **Descripción visual** muy concreta: edad, pelo, ropa con colores…
   
   **📋 Copiar fichas** copia una ficha por personaje para crearlos en Google Flow → *Caracteres*.
3. **Prompts**: revisa la lista. En cada escena puedes:
   - Activar o quitar personajes pulsando sus etiquetas.
   - Escribir una descripción de escena propia (o usar **✨ Mejorar escenas con IA**).
4. Pulsa **📋 Copiar todos los prompts** y pégalos donde vayas a generar las imágenes.

> Si en la extensión de Flow ya tienes configurados los personajes, desmarca **"Incluir descripción de personajes en cada prompt"** para que no se repitan.

## 🔑 IA de texto (opcional)

Solo hace falta para **detectar personajes** y **mejorar escenas** automáticamente. Sin clave todo lo demás funciona.

| Proveedor | Clave |
|---|---|
| **Google Gemini** (recomendado) | gratis en [Google AI Studio](https://aistudio.google.com/apikey) |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) |
| Pollinations | [enter.pollinations.ai](https://enter.pollinations.ai) |

🔒 Las claves se guardan **solo en tu navegador** y se envían directamente al proveedor.

## 📁 Estructura

```
index.html        Interfaz
css/styles.css    Estilos
js/splitter.js    División del guion y detección de personajes por escena
js/providers.js   IA de texto (Gemini, OpenAI, Pollinations)
js/storage.js     Guardado local (ajustes y proyecto)
js/app.js         Lógica principal
```

## Licencia

MIT
