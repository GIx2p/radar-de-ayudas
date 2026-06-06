# Radar de Ayudas

Catálogo **público y abierto** de ayudas y subvenciones en España, construido a partir de
fuentes oficiales. Pensado para que familias, asociaciones y trabajadores sociales puedan
encontrar fácilmente las ayudas a las que pueden optar.

> **Sin datos personales.** Este repositorio y la web que genera contienen únicamente
> información pública de convocatorias. Ningún dato sensible vive aquí.

## Estado

🚧 En construcción — versión 1 (lista filtrable con buscador).

## Alcance

- **Geográfico:** toda España (Estado, comunidades autónomas y entidades locales).
- **Fuente de datos:** [BDNS — Base de Datos Nacional de Subvenciones](https://www.infosubvenciones.es/bdnstrans/es/index)
  vía su API REST oficial (datos en JSON, actualización diaria).
- **Enfoque:** priorizar las ayudas dirigidas a personas físicas y familias.

## Cómo funciona

1. **Ingesta** (`ingest/`): un proceso descarga las convocatorias de la API de BDNS,
   las limpia y las normaliza a un fichero JSON.
2. **Catálogo** (`data/`): el JSON normalizado, versionado en este repositorio.
3. **Web** (`web/`): un sitio estático que carga ese JSON y ofrece búsqueda y filtros.
4. **Actualización automática**: una tarea programada refresca el catálogo periódicamente.

Ver decisiones de diseño en [`docs/decisiones.md`](docs/decisiones.md).

## Privacidad y separación

Este es el proyecto **público**. El sistema privado que cruza datos familiares sensibles
vive en un repositorio separado, con credenciales separadas, y nunca comparte datos con esta capa.
