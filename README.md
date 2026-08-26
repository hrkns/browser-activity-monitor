# Daily Site Time Tracker para Firefox

Extensión WebExtension que mide el tiempo diario en todos los sitios web que visitas.

## Qué cuenta como tiempo

- La pestaña debe estar activa.
- La ventana de Firefox debe tener foco.
- El usuario debe estar activo; tras 60 segundos de inactividad deja de contar.
- Cada hostname se registra por separado; `www.` se elimina para evitar duplicados.
- Solo se miden páginas HTTP y HTTPS, no páginas internas como `about:`.
- Los intervalos que cruzan medianoche se dividen entre ambos días.

## Instalar temporalmente

1. Abre `about:debugging` en Firefox.
2. Entra en **This Firefox / Este Firefox**.
3. Pulsa **Load Temporary Add-on / Cargar complemento temporal**.
4. Selecciona `manifest.json` de esta carpeta.
5. Pulsa el icono del addon para ver el ranking del día.

Las extensiones temporales desaparecen al reiniciar Firefox. Para instalación permanente, el addon debe firmarse/distribuirse según las reglas de Firefox Add-ons.

## Datos

Se guardan localmente en `browser.storage.local` con claves por fecha (`stats:AAAA-MM-DD`). Los días anteriores no se borran, aunque el popup muestra el día actual. Esto deja preparada una futura vista histórica.
