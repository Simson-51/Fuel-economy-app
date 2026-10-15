# Consumi Carburante (PWA)

App web installabile per tenere sotto controllo rifornimenti, consumi e spese di un veicolo (predisposta per Alfa Romeo Giulietta 1.4 MultiAir 170 CV del 2010).

- **Rifornimenti**: data, km, litri, prezzo alla pompa (opzionale), importo pagato (calcolato da litri × prezzo se vuoto), pieno/parziale.
- **Riepilogo e grafici**: consumo medio (metodo pieno su pieno), costo al km, prezzo medio, spesa mensile, km mensili, proiezione annuale.
- **Itinerario**: distanza da percorso (OpenStreetMap/OSRM, online) o manuale, consumo storico/veicolo/manuale, prezzo medio o manuale, pedaggi, persone.
- **Manutenzione**: tagliandi, gomme, revisione, assicurazione, bollo, riparazioni e altro con costi; scadenze per data e/o km con preavviso, promemoria nel Calendario (.ics), spesa per categoria e costo totale dell'auto.
- **Impostazioni**: tema (auto/chiaro/scuro), unità di consumo (L/100 km o km/L), preavviso scadenze, correzioni per tipo di percorso, veicoli.
- **Dati**: salvati in locale (localStorage), backup JSON e export CSV. Funziona offline.

## Uso
Nessuna build: servire la cartella con un server statico (`python3 -m http.server`) oppure usare GitHub Pages: il workflow `.github/workflows/pages.yml` pubblica il sito a ogni push su `main`, poi "Aggiungi a schermata Home" dal telefono.
