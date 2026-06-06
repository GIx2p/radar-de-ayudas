# Decisiones de diseño — Radar de Ayudas

Registro breve de las decisiones tomadas, para no perder el porqué entre sesiones.

## Contexto

Proyecto A (público) de un sistema mayor A+B. B (privado) cruzará datos familiares
sensibles y vive aparte. A debe ser cimiento sólido para A+B sin exponer nunca datos de B.

## Decisiones

- **D1 — Fuente de datos: BDNS (API REST oficial).** Robusta, oficial, JSON, diaria,
  nacional. Evita el rastreo frágil de webs sueltas. BOE/BOCM quedan como complemento futuro.
- **D2 — Alcance geográfico: toda España.** Estado + 17 CCAA + entidades locales. BDNS ya es
  nacional, así que ampliar desde Madrid no añade apenas complejidad de ingesta; el reto pasa a
  ser el volumen → los filtros y la relevancia son la prioridad de producto. Filtro principal: CCAA.
- **D3 — Enfoque de relevancia: priorizar personas físicas / familias.** Reducir ruido de
  subvenciones a empresas y otras administraciones.
- **D4 — Almacén: JSON versionado en Git.** Gratis, auditable, con historial. Sin base de datos
  ni servidor.
- **D5 — Web: sitio estático con filtrado en cliente.** v1 = lista filtrable con buscador.
  Hosting gratuito (GitHub/Cloudflare Pages). Sin backend.
- **D6 — Actualización: tarea programada (GitHub Actions).** Cero mantenimiento manual.
- **D7 — Notion descartado** como núcleo (preferencia del usuario y no necesario).
- **D8 — Separación neta A/B:** repo público para A, repo privado + credenciales separadas para B.
  Datos sensibles nunca en la capa pública.

## Pendiente de decidir

- Dominio propio (`radardeayudas.*`) — opcional, se compra más adelante. Arranque en URL gratuita.
- Diseño detallado del Proyecto B — se aborda cuando A esté cerrado o casi.
