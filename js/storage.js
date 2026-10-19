/* Guardado local: ajustes en localStorage y el proyecto (con imágenes) en IndexedDB. */
(function () {
  const DB_NAME = "generador-imagenes-youtube";
  const STORE = "kv";
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function idbGet(key) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("No se pudo leer IndexedDB", e);
      return undefined;
    }
  }

  async function idbSet(key, value) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("No se pudo guardar en IndexedDB", e);
    }
  }

  function getSettings(defaults) {
    try {
      return Object.assign({}, defaults, JSON.parse(localStorage.getItem("giy-settings") || "{}"));
    } catch (e) {
      return Object.assign({}, defaults);
    }
  }

  function setSettings(settings) {
    try {
      localStorage.setItem("giy-settings", JSON.stringify(settings));
    } catch (e) {
      console.warn("No se pudieron guardar los ajustes", e);
    }
  }

  window.Storage2 = { idbGet, idbSet, getSettings, setSettings };
})();
