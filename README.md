# Consumi Carburante (PWA)

App web installabile per tenere sotto controllo rifornimenti, consumi e spese di un veicolo (predisposta per Alfa Romeo Giulietta 2010).

- **Rifornimenti**: data, km, litri, prezzo alla pompa (opzionale), importo pagato (calcolato da litri × prezzo se vuoto), pieno/parziale.
- **Riepilogo e grafici**: consumo medio (metodo pieno su pieno), costo al km, prezzo medio, spesa mensile, km mensili, proiezione annuale.
- **Itinerario**: distanza da percorso (OpenStreetMap/OSRM, online) o manuale, consumo storico/veicolo/manuale, prezzo medio o manuale, pedaggi, persone.
- **Dati**: salvati in locale (localStorage), backup JSON e export CSV. Funziona offline.

## Uso
Nessuna build: servire la cartella con un server statico (`python3 -m http.server`) oppure pubblicarla su GitHub Pages (HTTPS), poi "Aggiungi a schermata Home" dal telefono.
