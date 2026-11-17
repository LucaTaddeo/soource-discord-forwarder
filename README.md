# Inoltro Discord → webhook

Bot per il server Discord **Soource**. Quando arriva un messaggio nuovo, controlla i filtri e, se il messaggio è rilevante, lo invia con una richiesta HTTP `POST` a un webhook.

Il bot non scrive nei canali e non risponde ai messaggi. Deve restare acceso: se lo chiudi sul tuo computer, smette di inoltrare. Per lasciarlo sempre acceso usa [Railway](#3-metterlo-online) (la strada principale) oppure [Render](#32-alternativa-render).

Il testo dei messaggi **non** viene scritto nei log. Nei log non compaiono né il token del bot né il valore di `WEBHOOK_AUTHORIZATION`.

## Cosa arriva al webhook

Ogni messaggio inoltrato è un JSON con questi campi:

| Campo | Significato |
| --- | --- |
| `server` | Nome del server. `null` se è un messaggio diretto. |
| `server_id` | ID del server. `null` se è un messaggio diretto. |
| `channel` | Nome del canale, oppure `DM`. |
| `channel_id` | ID del canale. |
| `author` | Nome visualizzato di chi ha scritto (soprannome del server, se c’è). |
| `author_id` | ID di chi ha scritto. |
| `content` | Testo leggibile. Le menzioni diventano `@nome` e `#canale`. Se ci sono allegati, gli URL sono in coda. Se ci sono embed, i titoli sono in coda come `Embed: titolo`. |
| `url` | Link per aprire il messaggio su Discord. |
| `mentions_owner` | `true` se il messaggio menziona l’owner: `@utente`, un ruolo che l’owner ha in quel server, oppure `@everyone` / `@here` se l’owner è nel server. |
| `is_reply_to_owner` | `true` se il messaggio è una risposta a un messaggio dell’owner. Un inoltro non conta come risposta. |
| `is_dm` | `true` se è un messaggio diretto al bot. |
| `created_at` | Data del messaggio, in formato ISO. |

Esempio:

```json
{
  "server": "Soource",
  "server_id": "123456789012345678",
  "channel": "generale",
  "channel_id": "234567890123456789",
  "author": "Ada",
  "author_id": "345678901234567890",
  "content": "ciao @Luca\n\nhttps://cdn.discordapp.com/attachments/..../foto.png\n\nEmbed: Report",
  "url": "https://discord.com/channels/123456789012345678/234567890123456789/456789012345678901",
  "mentions_owner": true,
  "is_reply_to_owner": false,
  "is_dm": false,
  "created_at": "2026-11-17T12:00:00.000Z"
}
```

La richiesta ha un timeout di circa 10 secondi. Se la rete fallisce o il webhook risponde con un errore 5xx, il bot riprova fino a 3 volte (dopo 1 secondo e poi dopo 3 secondi). Un errore 4xx, per esempio 401, non viene ritentato: di solito significa che l’URL o l’Authorization sono sbagliati. Il bot non si chiude se un invio fallisce: scrive l’errore nel log e continua.

## Cosa non viene inoltrato

- I messaggi dei bot, incluso questo bot, e i messaggi inviati da webhook.
- I messaggi di sistema (ingresso nel server, boost, pin, e simili).
- I messaggi scritti dall’owner, se hai impostato `OWNER_USER_ID`. Per provare il bot scrivi da un altro account.
- I messaggi di server non elencati in `GUILD_IDS`, se quella variabile è impostata.
- I messaggi di canali non elencati in `CHANNEL_IDS`, se quella variabile è impostata.
- Con `FORWARD_MODE=mentions`: i messaggi che non menzionano l’owner, non sono una risposta all’owner e non sono un messaggio diretto.

I **messaggi diretti al bot passano sempre**, anche se hai compilato `GUILD_IDS` o `CHANNEL_IDS`. Un DM non appartiene a un server né a un canale del server. Vengono comunque scartati se li ha scritti un bot o l’owner.

Per un thread serve l’ID del thread, non quello del canale padre: Discord tratta il thread come un canale a sé.

## Requisiti

- Node.js 22 o successivo, solo se lo avvii sul tuo computer. Su Railway e Render l’immagine Docker porta già Node.
- L’applicazione del bot già creata nel [Discord Developer Portal](https://discord.com/developers/applications). Ti serve il token, non devi creare un’altra applicazione.
- L’URL del webhook e il valore dell’header `Authorization`, dal pannello della routine del Grok Bot.

Il portale Discord è in inglese. Qui sotto i menu sono indicati con il nome che vedi lì.

---

## 1. Preparare il bot su Discord

Apri [discord.com/developers/applications](https://discord.com/developers/applications) e seleziona l’applicazione del bot.

### 1.1 Attivare il Message Content Intent

Senza questo permesso Discord consegna i messaggi vuoti: il bot vede che qualcuno ha scritto, ma non il testo.

1. Nel menu a sinistra apri **Bot**.
2. Scorri fino a **Privileged Gateway Intents**.
3. Attiva solo **Message Content Intent**.
4. Non serve attivare **Presence Intent** né **Server Members Intent**.
5. Salva le modifiche con **Save Changes**.

Se il bot è già acceso, riavvialo dopo aver salvato. Altrimenti nei log compare un errore simile a `Used disallowed intents`.

### 1.2 Copiare il token

Sempre nella pagina **Bot**:

1. Sotto **Token** clicca **Reset Token** oppure **View Token**.
2. Copia il token e mettilo in un posto temporaneo e privato (lo incollerai nella variabile `DISCORD_TOKEN`).
3. Non copiare il **Client Secret** della pagina **OAuth2**: non è il token e il bot non entrerà su Discord.

Il token è una password. Non incollarlo in chat, non metterlo nel README e non committarlo. Se lo hai esposto, torna su **Bot** e fai di nuovo **Reset Token**, poi aggiorna la variabile d’ambiente.

### 1.3 Creare il link di invito

1. Nel menu a sinistra apri **OAuth2**, poi **URL Generator**.
2. In **Scopes** spunta solo `bot`.
3. In **Bot Permissions** spunta solo:
   - **View Channels**
   - **Read Message History**
4. In fondo alla pagina copia il link generato.

`View Channels` serve perché Discord consegni i messaggi dei canali visibili. `Read Message History` serve quando un messaggio è una risposta e Discord non allega il messaggio originale: il bot lo rilegge per capire se la risposta è all’owner.

Se il generatore non è disponibile, costruisci il link a mano. Sostituisci `IL_TUO_CLIENT_ID` con l’**Application ID** che trovi in **General Information** (è un numero, non il token):

```text
https://discord.com/oauth2/authorize?client_id=IL_TUO_CLIENT_ID&permissions=66560&scope=bot
```

`66560` è la somma dei due permessi sopra.

### 1.4 Invitare il bot nel server Soource

1. Apri il link nel browser, connesso con un account Discord che può gestire il server Soource.
2. Nel menu scegli il server **Soource**.
3. Conferma con **Autorizza** / **Authorize**.
4. Se Discord dice che il bot non è pubblico: nella pagina **Bot** del portale attiva **Public Bot**, salva, e ripeti l’invito. In alternativa invita il bot dall’account che possiede l’applicazione.

Se un canale è privato (nascosto a `@everyone`), aggiungi il ruolo del bot tra quelli che possono vederlo. Il ruolo viene creato da Discord quando inviti il bot e ha il nome dell’applicazione.

### 1.5 Trovare gli ID (Modalità sviluppatore)

Gli ID sono numeri lunghi. Servono solo se vuoi compilare `OWNER_USER_ID`, `GUILD_IDS` o `CHANNEL_IDS`.

Sul computer, nell’app Discord o su [discord.com/app](https://discord.com/app):

1. Apri **Impostazioni utente** (l’ingranaggio).
2. Vai su **Avanzate** / **Advanced**. In alcune versioni sta sotto **Impostazioni attività app** / **App Settings**.
3. Attiva **Modalità sviluppatore** / **Developer Mode**.

Poi:

- ID del server: tasto destro sull’icona del server → **Copia ID server** / **Copy Server ID**.
- ID del canale: tasto destro sul nome del canale → **Copia ID canale** / **Copy Channel ID**. Per un thread, tasto destro sul thread.
- ID utente dell’owner: tasto destro sul suo nome (in un messaggio o nella lista membri) → **Copia ID utente** / **Copy User ID**.

Sul telefono: **Impostazioni → Avanzate → Modalità sviluppatore**, poi tieni premuto su server, canale o utente e scegli **Copia ID**.

Incolla solo il numero. Il bot accetta anche una menzione copiata, per esempio `<@123>` o `<#123>`, ma il numero da solo è la forma giusta.

---

## 2. Variabili di ambiente

Crea un file `.env` nella cartella del progetto solo per le prove sul tuo computer. Parti dal modello:

```bash
cp .env.example .env
```

Poi compila `.env`. Su Railway e Render non usi questo file: le stesse variabili si inseriscono nel pannello del servizio. Non committare `.env`.

| Variabile | Obbligatoria | Valore |
| --- | --- | --- |
| `DISCORD_TOKEN` | sì | Token copiato dalla pagina **Bot**. |
| `WEBHOOK_URL` | sì | URL del webhook, dal pannello della routine Grok Bot. |
| `WEBHOOK_AUTHORIZATION` | sì | Valore completo dell’header `Authorization`, dallo stesso pannello. |
| `OWNER_USER_ID` | no | ID utente dell’owner. I suoi messaggi vengono ignorati. Serve anche per `mentions_owner` e per la modalità `mentions`. |
| `GUILD_IDS` | no | ID dei server da seguire, separati da virgola. Vuoto = tutti i server in cui si trova il bot. |
| `CHANNEL_IDS` | no | ID dei canali da seguire, separati da virgola. Vuoto = tutti i canali. I DM passano sempre. |
| `FORWARD_MODE` | no | `all` (predefinito) oppure `mentions`. |

`all` inoltra ogni messaggio che passa gli altri filtri. `mentions` inoltra solo:

- un messaggio che menziona l’owner (utente, ruolo dell’owner, `@everyone` o `@here`);
- una risposta a un messaggio dell’owner;
- un messaggio diretto al bot.

Se scegli `mentions` ma lasci vuoto `OWNER_USER_ID`, il bot può riconoscere solo i messaggi diretti e lo scrive nel log all’avvio.

### Webhook dal pannello Grok Bot

`WEBHOOK_URL` e `WEBHOOK_AUTHORIZATION` non si inventano: li copi dal pannello della routine del Grok Bot, il servizio che deve ricevere i messaggi.

1. Apri il pannello della routine.
2. Copia l’URL del webhook e incollalo in `WEBHOOK_URL`.
3. Copia il valore dell’header **Authorization** e incollalo in `WEBHOOK_AUTHORIZATION`.

Il valore va copiato per intero, anche se inizia con `Bearer `. Esempio di valore corretto:

```text
Bearer eyJhbGciOi...
```

Non aggiungere tu la parola `Authorization:`. Il bot imposta quel nome di header da solo e invia il valore così com’è. Se nel pannello vedi `Authorization: Bearer abc`, in `WEBHOOK_AUTHORIZATION` incolla solo `Bearer abc`.

Preferisci un URL `https://`. Un URL `http://` funziona, ma il contenuto dei messaggi viaggia in chiaro.

---

## 3. Metterlo online

Il bot non ha un sito e non apre una porta. È un processo che resta connesso a Discord. Non aggiungere un dominio pubblico.

### 3.1 Railway (strada principale)

1. Crea un account su [railway.com](https://railway.com).
2. Clicca **New Project**.
3. Se il codice è su GitHub o GitLab ed è collegato a Railway, scegli **Deploy from GitHub repo** (o GitLab) e seleziona questo repository. Railway legge `railway.json` e costruisce l’immagine dal `Dockerfile`.
4. Apri il servizio → **Variables**. Aggiungi almeno:
   - `DISCORD_TOKEN`
   - `WEBHOOK_URL`
   - `WEBHOOK_AUTHORIZATION`
   - e le opzionali che ti servono (`OWNER_USER_ID`, `GUILD_IDS`, `CHANNEL_IDS`, `FORWARD_MODE`).
5. Inseriscile dal pannello, non nel terminale, così non restano nella cronologia dei comandi.
6. Avvia il deploy. Apri **Logs**.

All’avvio devi vedere una riga `Connesso come ...` e l’elenco dei server, per esempio:

```text
[2026-11-17T12:00:01.000Z] INFO Connesso come Soource Forwarder (123456789012345678)
[2026-11-17T12:00:01.000Z] INFO Server visibili (1):
[2026-11-17T12:00:01.000Z] INFO   • Soource (111111111111111111)
```

Se un ID in `GUILD_IDS` non è tra i server visibili, il log lo segnala: il bot non è in quel server, oppure l’ID è sbagliato.

Il comando dentro il container è `node src/index.js`. Quando Railway ferma il servizio gli manda `SIGTERM`: il bot smette di prendere messaggi nuovi, aspetta qualche secondo gli invii già partiti e si chiude. Se il processo esce con un errore, Railway lo riavvia fino a 10 volte.

#### Se Railway non può collegare il repository

Usa la CLI dalla cartella del progetto, sul tuo computer. Carica i file senza passare dall’host Git.

1. Installa Node.js 22 da [nodejs.org](https://nodejs.org).
2. Installa la CLI ed entra:

```bash
npm install -g @railway/cli
railway login
```

3. Nella cartella del progetto:

```bash
railway init
railway up
```

4. Le variabili, anche in questo caso, impostale dalla dashboard di Railway (**Variables**), poi ridistribuisci se il servizio non si riavvia da solo.

In alternativa puoi costruire l’immagine a mano e pubblicarla su un registro che Railway sa leggere:

```bash
docker build -t soource-discord-forwarder .
```

Poi, nel progetto Railway, crea un servizio **Deploy from Docker image** e indica l’immagine che hai pubblicato (Docker Hub o GitHub Container Registry). Le variabili si impostano lo stesso nel pannello.

Se la build Docker fallisce, nel servizio Railway puoi cambiare il builder in **Nixpacks** e il comando di avvio in `node src/index.js`, con build `npm ci`. Il `Dockerfile` resta la strada prevista da `railway.json`.

### 3.2 Alternativa: Render

Render va bene se non usi Railway. Serve un **Background Worker** sempre acceso. Un Web Service gratuito non va bene: va in sleep e questo bot non risponde a richieste HTTP.

1. Accedi su [dashboard.render.com](https://dashboard.render.com).
2. Se il repository è su GitHub o GitLab, clicca **New → Blueprint** e collega il repository. Render legge `render.yaml` e crea un worker Docker chiamato `soource-discord-forwarder`.
3. Quando te lo chiede, compila `DISCORD_TOKEN`, `WEBHOOK_URL` e `WEBHOOK_AUTHORIZATION`. `FORWARD_MODE` è già `all`: cambialo nel pannello se vuoi `mentions`.
4. Aggiungi `OWNER_USER_ID`, `GUILD_IDS` e `CHANNEL_IDS` solo se ti servono. Lasciali vuoti per non filtrare.
5. Scegli un piano che tenga il worker acceso (il file propone `starter`; puoi cambiarlo). Conferma il deploy.
6. Apri i **Logs** e controlla `Connesso come` e l’elenco dei server, come su Railway.

#### Creare il worker a mano

Se non vuoi il Blueprint: **New → Background Worker**.

- **Environment**: Docker, con il `Dockerfile` di questo repository.
- Oppure **Environment**: Node, **Build Command** `npm ci`, **Start Command** `node src/index.js`.

Poi aggiungi le stesse variabili nella sezione **Environment**.

#### Se Render non può collegare il repository

Sul tuo computer, dalla cartella del progetto:

```bash
docker build -t soource-discord-forwarder .
```

Pubblica l’immagine su un registro (Docker Hub o GitHub Container Registry) e nel worker Render scegli quell’immagine. In alternativa copia il progetto su un repository GitHub o GitLab, che Render sa collegare, e usa il Blueprint.

Per una prova solo sul tuo computer, senza pubblicare l’immagine:

```bash
docker build -t soource-discord-forwarder .
docker run --rm --env-file .env soource-discord-forwarder
```

`--env-file` legge il `.env` locale. L’immagine non contiene quel file.

---

## 4. Come provarlo

### 4.1 Sul tuo computer

Dalla cartella del progetto, con Node.js 22:

```bash
cp .env.example .env
```

Compila `.env` come nel [punto 2](#2-variabili-di-ambiente). Poi:

```bash
npm install
npm test
npm start
```

`npm test` non parla con Discord e non usa il token: controlla i filtri, il JSON e i tentativi del webhook.

`npm start` collega il bot. Nel terminale devono comparire `Avvio del bot`, `Connesso come ...` e `Server visibili`. Se il nome Soource non c’è, l’invito non è andato a buon fine.

### 4.2 Inviare un messaggio di prova

1. Usa un account Discord che **non** è l’owner, se hai impostato `OWNER_USER_ID`. I messaggi dell’owner vengono ignorati di proposito.
2. Scrivi in un canale che il bot può vedere. Se hai impostato `CHANNEL_IDS`, scrivi in uno di quei canali. Se `FORWARD_MODE` è `mentions`, menziona l’owner, rispondi a un suo messaggio, oppure scrivi un messaggio diretto al bot.
3. Nel log deve comparire una riga simile a:

```text
[2026-11-17T12:04:00.000Z] INFO Inoltrato messaggio 456... da Ada in Soource / #generale (HTTP 200)
```

4. Controlla il servizio che riceve il webhook: deve comparire il JSON.

Se invece vedi `Invio non riuscito`, il bot è su Discord ma il webhook ha rifiutato o non ha risposto. La riga di log contiene lo stato HTTP (per esempio `HTTP 401`) e non contiene il valore di Authorization.

### 4.3 Provare solo il webhook

Questo comando non usa Discord. Invia un JSON di esempio a `WEBHOOK_URL`, con lo stesso header e gli stessi tentativi del bot. Legge `.env` oppure le variabili già presenti nell’ambiente.

```bash
npm run test-webhook
```

Se va a buon fine:

```text
Webhook ok (HTTP 200) al tentativo 1
```

Il processo termina con codice 0. Se il webhook non risponde, termina con codice 1 e il bot vero e proprio non viene toccato.

Dentro un container già costruito:

```bash
docker run --rm --env-file .env soource-discord-forwarder node scripts/send-sample-webhook.js
```

---

## Se qualcosa non va

| Cosa vedi | Cosa fare |
| --- | --- |
| `Variabili d'ambiente mancanti` | Manca `DISCORD_TOKEN`, `WEBHOOK_URL` o `WEBHOOK_AUTHORIZATION`. Su Railway/Render controlla **Variables** e ridistribuisci. |
| `An invalid token` | Hai incollato il Client Secret, un token vecchio, o ci sono spazi. Rigenera il token nella pagina **Bot** e aggiorna la variabile. |
| `Used disallowed intents` | Attiva **Message Content Intent**, salva, riavvia il bot. |
| Il bot è online ma `Server visibili (0)` | Non è stato invitato, oppure l’invito è stato rifiutato. Ripeti il [link di invito](#14-invitare-il-bot-nel-server-soource). |
| Il server c’è, ma i messaggi non partono | Stai scrivendo dall’account owner; il canale non è in `CHANNEL_IDS`; il server non è in `GUILD_IDS`; oppure `FORWARD_MODE=mentions` e il messaggio non menziona l’owner, non è una risposta e non è un DM. |
| I messaggi partono con `content` vuoto | **Message Content Intent** spento, oppure il bot è stato avviato prima di attivarlo. Attivalo e riavvia. |
| `HTTP 401` o `HTTP 403` | `WEBHOOK_AUTHORIZATION` non è il valore esatto del pannello. Non deve contenere il prefisso `Authorization:`. |
| `errore di rete` o `HTTP 5xx` | Il servizio ricevente non è raggiungibile. Il bot riprova tre volte e poi continua. Controlla `WEBHOOK_URL`. |
| Un canale privato non arriva | Il ruolo del bot non può vedere quel canale. Aggiungilo ai permessi del canale. |

## Comandi

| Comando | A cosa serve |
| --- | --- |
| `npm install` | Installa le dipendenze. |
| `npm start` | Avvia il bot. |
| `npm test` | Esegue i test dei filtri, del JSON e dei tentativi HTTP. |
| `npm run test-webhook` | Invia un payload di prova al webhook. |

Dipendenze di runtime: `discord.js` 14 e `dotenv`. I test usano il test runner incluso in Node, senza altre librerie.

## File principali

| File | Ruolo |
| --- | --- |
| `src/index.js` | Connessione a Discord, log di avvio, chiusura pulita. |
| `src/filter.js` | Regole: bot, owner, server, canale, modalità `all` / `mentions`. |
| `src/evaluate.js` | Decide se inoltrare e costruisce il JSON. |
| `src/webhook.js` | `POST` con timeout, tentativi e header `Authorization`. |
| `scripts/send-sample-webhook.js` | Payload di prova. |
| `Dockerfile` | Immagine usata da Railway e da Render. |
