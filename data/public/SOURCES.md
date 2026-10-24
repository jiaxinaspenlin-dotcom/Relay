# Public data snapshots

| File | Agency | URL | Retrieved | Filters | Rows | Terms |
|---|---|---|---|---|---|---|
| `towns.csv` | Synthea geography files (derived from U.S. Census data) | https://github.com/synthetichealth/synthea (src/main/resources/geography, commit bd8a52b) | 2026-10-24 | Massachusetts places; town-level point or mean of ZCTA points; county from demographics.csv | 434 | Apache-2.0 |
| `places_county.csv` | CDC (PLACES) | data.cdc.gov/resource/swc5-untb | 2026-10-24 | MA; 5 measures; crude prevalence | 70 | U.S. government public data |
| `hospitals_massgis.csv` | Commonwealth of Massachusetts (MassGIS) | https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/Hospitals/MapServer/0 | 2026-10-24 | all features, WGS84 points | 103 | Official data; link the layer, don't republish the site |
| `ej_blockgroups.csv` | Commonwealth of Massachusetts (EEA / MassGIS) | https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/EJ2020/MapServer/0 | 2026-10-24 | EJ='Yes' block groups | 2604 | Official data; link the layer |
| `hrsa_hpsa_pc_ma.csv` | HRSA | https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_PC.csv | 2026-10-24 | Primary State Abbreviation=MA | 1232 | U.S. government public data |
| `hospitals_cms_ma.csv` | CMS | data.cms.gov/provider-data dataset xubh-q36u (Hospital General Information) | 2026-10-24 | state=MA | 84 | U.S. government public data |
| `readmissions_ma.csv` | CMS | data.cms.gov/provider-data dataset 9n3s-kdb3 (HRRP) | 2026-10-24 | state=MA | 330 | U.S. government public data |
| `clinicians_ma.csv` | CMS | data.cms.gov/provider-data dataset mj5m-pzi6 (National Downloadable File) | 2026-10-24 | state=MA; individual name columns dropped | 97989 | U.S. government public data |
