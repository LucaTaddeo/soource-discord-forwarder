# Inoltro Discord → webhook

Bot per il server Discord **Soource**. Quando arriva un messaggio nuovo, controlla i filtri e, se il messaggio è rilevante, lo invia con una richiesta HTTP `POST` a un webhook.

Se imposti `MCP_API_KEY`, lo stesso processo espone anche un server [MCP](https://modelcontextprotocol.io) su HTTP. Un assistente AI può così leggere Discord e, se lo consenti, scriverci **con l’account del bot**, non con il tuo utente. L’inoltro al webhook resta attivo in entrambi i casi. Senza `MCP_API_KEY` il bot si comporta come prima: inoltra i messaggi e non scrive da solo.

Il processo deve restare acceso: se lo chiudi sul tuo computer, smette di inoltrare e l’endpoint MCP non risponde. Per lasciarlo sempre acceso usa [Railway](#3-metterlo-online) (la strada principale) oppure [Render](#32-alternativa-render).

Il testo dei messaggi **non** viene scritto nei log. Nei log non compaiono né il token del bot, né `WEBHOOK_AUTHORIZATION`, né `MCP_API_KEY`.

## Cosa arriva al webhook

I messaggi della stessa conversazione partono insieme, in un solo `POST`. La conversazione è il canale: in un thread è l’ID del thread, in un messaggio diretto è l’ID del canale DM. Ogni messaggio nuovo di quella conversazione azzera l’attesa. Quando per `FORWARD_DEBOUNCE_MS` millisecondi non arriva niente (predefinito 2 minuti), il bot invia il gruppo.

Il gruppo parte prima anche in due casi: se contiene già `FORWARD_MAX_BATCH` messaggi (predefinito 20), oppure se il primo messaggio del gruppo è in attesa da più di `FORWARD_MAX_WAIT_MS` (predefinito 10 minuti). Così una richiesta scritta in più messaggi di seguito arriva come una notifica sola.

Con `FORWARD_DEBOUNCE_MS=0` non c’è attesa e non c’è raggruppamento: ogni messaggio parte da solo, come prima. I messaggi del bot, compresi quelli che scrive lui stesso, non entrano nel gruppo e non azzerano l’attesa.

Il JSON tiene i campi di prima. `author`, `author_id`, `content`, `url`, `is_reply_to_owner` e `created_at` descrivono l’ultimo messaggio del gruppo, così un servizio che legge solo quei campi continua a funzionare. `server`, `server_id`, `channel`, `channel_id`, `thread`, `thread_id` e `is_dm` descrivono la conversazione. `mentions_owner` è `true` se almeno un messaggio del gruppo menziona l’owner.

| Campo | Significato |
| --- | --- |
| `server` | Nome del server. `null` se è un messaggio diretto. |
| `server_id` | ID del server. `null` se è un messaggio diretto. |
| `channel` | Nome del canale, oppure `DM`. In un thread resta il nome del thread. |
| `channel_id` | ID del canale. In un thread è l’ID del thread. In un DM è l’ID del canale diretto. |
| `thread` | Nome del thread. `null` se il messaggio non è in un thread. |
| `thread_id` | ID del thread. `null` se non è un thread. |
| `parent_channel` | Nome del canale che contiene il thread. `null` se non è un thread o se Discord non ha indicato il padre. |
| `parent_channel_id` | ID del canale padre. `null` negli stessi casi di `parent_channel`. |
| `author` | Nome visualizzato di chi ha scritto l’ultimo messaggio (soprannome del server, se c’è). |
| `author_id` | ID di chi ha scritto l’ultimo messaggio. |
| `content` | Testo leggibile dell’ultimo messaggio. Le menzioni diventano `@nome` e `#canale`. Se ci sono allegati, gli URL sono in coda. Se ci sono embed, i titoli sono in coda come `Embed: titolo`. |
| `url` | Link per aprire l’ultimo messaggio su Discord. |
| `mentions_owner` | `true` se un messaggio del gruppo menziona l’owner: `@utente`, un ruolo che l’owner ha in quel server, oppure `@everyone` / `@here` se l’owner è nel server. |
| `is_reply_to_owner` | `true` se l’ultimo messaggio è una risposta a un messaggio dell’owner. Un inoltro non conta come risposta. |
| `is_dm` | `true` se è un messaggio diretto al bot. |
| `created_at` | Data dell’ultimo messaggio, in formato ISO. |
| `message_count` | Quanti messaggi contiene questo invio. |
| `first_timestamp` | Data del primo messaggio del gruppo, in formato ISO. |
| `last_timestamp` | Data dell’ultimo messaggio del gruppo, in formato ISO. |
| `messages` | I messaggi del gruppo, dal più vecchio al più recente. |

Ogni elemento di `messages` ha `id`, `author`, `author_id`, `content`, `timestamp`, `url`, `attachments`, `mentions_owner` e `is_reply_to_owner`. `content` è il testo leggibile, con i titoli degli embed in coda. Gli URL degli allegati stanno in `attachments` (un elenco, vuoto se non ce ne sono) e non vengono ripetuti nel `content` di quell’elemento. Nel `content` in cima al JSON, quello dell’ultimo messaggio, gli URL restano in coda come prima.

Esempio di due messaggi raggruppati. Il primo menziona l’owner, il secondo no: `mentions_owner` in cima è `true`, mentre `author` e `content` sono quelli dell’ultimo messaggio.

```json
{
  "server": "Soource",
  "server_id": "123456789012345678",
  "channel": "generale",
  "channel_id": "234567890123456789",
  "thread": null,
  "thread_id": null,
  "parent_channel": null,
  "parent_channel_id": null,
  "author": "Ada",
  "author_id": "345678901234567890",
  "content": "e questa è la seconda parte\n\nhttps://cdn.discordapp.com/attachments/..../foto.png",
  "url": "https://discord.com/channels/123456789012345678/234567890123456789/456789012345678902",
  "mentions_owner": true,
  "is_reply_to_owner": false,
  "is_dm": false,
  "created_at": "2026-11-17T12:00:04.000Z",
  "message_count": 2,
  "first_timestamp": "2026-11-17T12:00:00.000Z",
  "last_timestamp": "2026-11-17T12:00:04.000Z",
  "messages": [
    {
      "id": "456789012345678901",
      "author": "Ada",
      "author_id": "345678901234567890",
      "content": "ciao @Luca, ti scrivo a pezzi",
      "timestamp": "2026-11-17T12:00:00.000Z",
      "url": "https://discord.com/channels/123456789012345678/234567890123456789/456789012345678901",
      "attachments": [],
      "mentions_owner": true,
      "is_reply_to_owner": false
    },
    {
      "id": "456789012345678902",
      "author": "Ada",
      "author_id": "345678901234567890",
      "content": "e questa è la seconda parte",
      "timestamp": "2026-11-17T12:00:04.000Z",
      "url": "https://discord.com/channels/123456789012345678/234567890123456789/456789012345678902",
      "attachments": ["https://cdn.discordapp.com/attachments/..../foto.png"],
      "mentions_owner": false,
      "is_reply_to_owner": false
    }
  ]
}
```

La richiesta ha un timeout di circa 10 secondi. Se la rete fallisce o il webhook risponde con un errore 5xx, il bot riprova fino a 3 volte (dopo 1 secondo e poi dopo 3 secondi). Un errore 4xx, per esempio 401, non viene ritentato: di solito significa che l’URL o l’Authorization sono sbagliati. Il bot non si chiude se un invio fallisce: scrive l’errore nel log e continua.

## Cosa non viene inoltrato

- I messaggi dei bot, incluso questo bot, e i messaggi inviati da webhook. Non entrano in un gruppo e non azzerano l’attesa.
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
3. Attiva **Message Content Intent**.
4. Se userai il server MCP, attiva anche **Server Members Intent**: serve al tool `list_members`. Senza `MCP_API_KEY` lascialo spento. Il bot lo richiede solo quando l’MCP è acceso, e un intent acceso nel codice ma spento nel portale impedisce l’accesso a Discord.
5. Non serve **Presence Intent**.
6. Salva le modifiche con **Save Changes**.

Se il bot è già acceso, riavvialo dopo aver salvato. Altrimenti nei log compare un errore simile a `Used disallowed intents`. Il messaggio ricorda anche il **Server Members Intent** quando `MCP_API_KEY` è impostata.

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

`View Channels` serve perché Discord consegni i messaggi dei canali visibili. `Read Message History` serve quando un messaggio è una risposta e Discord non allega il messaggio originale: il bot lo rilegge per capire se la risposta è all’owner. Gli stessi due permessi bastano ai tool MCP di sola lettura (`read_messages`, `search_messages`, `get_message`).

#### Permessi per i tool MCP che scrivono

Servono solo se `ALLOW_WRITE` non è `false` e vuoi che l’assistente invii messaggi, reagisca, crei thread o fissi messaggi. Sono sempre azioni **dell’account del bot**, non del tuo utente. In **Bot Permissions** aggiungi anche:

- **Send Messages**
- **Send Messages in Threads**
- **Create Public Threads**
- **Add Reactions**
- **Manage Messages**, solo per `pin_message` e `unpin_message`

`edit_message` e `delete_message` funzionano soltanto sui messaggi che ha scritto il bot, anche se Manage Messages permetterebbe di più.

Se il bot è già nel server con i soli permessi di lettura, apri di nuovo il link di invito e conferma: Discord aggiorna il ruolo del bot. In alternativa vai in **Impostazioni del server → Ruoli**, apri il ruolo del bot e spunta le stesse voci.

Link con lettura e scrittura (sostituisci `IL_TUO_CLIENT_ID` con l’**Application ID**):

```text
https://discord.com/oauth2/authorize?client_id=IL_TUO_CLIENT_ID&permissions=309237722176&scope=bot
```

`309237722176` è la somma dei permessi di lettura e di quelli elencati qui sopra. I messaggi diretti (`send_dm`) non hanno un permesso in più: Discord li consegna solo se l’utente condivide un server col bot e non ha chiuso i DM.

Se il generatore non è disponibile, costruisci il link di sola lettura a mano. Sostituisci `IL_TUO_CLIENT_ID` con l’**Application ID** che trovi in **General Information** (è un numero, non il token):

```text
https://discord.com/oauth2/authorize?client_id=IL_TUO_CLIENT_ID&permissions=66560&scope=bot
```

`66560` è la somma di **View Channels** e **Read Message History**.

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
| `FORWARD_DEBOUNCE_MS` | no | Millisecondi di silenzio dopo l’ultimo messaggio di una conversazione, prima di inviare il gruppo. Predefinito `120000` (2 minuti). `0` invia subito ogni messaggio, senza raggruppare. |
| `FORWARD_MAX_BATCH` | no | Massimo di messaggi in un gruppo. Raggiunto il limite, il bot invia subito. Predefinito `20`. |
| `FORWARD_MAX_WAIT_MS` | no | Tempo massimo dal primo messaggio del gruppo, in millisecondi. Superato quel tempo, il bot invia anche se la conversazione non è ancora in silenzio. Predefinito `600000` (10 minuti). |
| `MCP_API_KEY` | no | Chiave dell’endpoint MCP. Se è vuota, `/mcp` non parte: restano l’inoltro e `GET /health`. |
| `ALLOW_WRITE` | no | `true` (predefinito) oppure `false`. Con `false` i tool che inviano messaggi, reagiscono, modificano, cancellano, fissano, creano thread o mandano DM non vengono registrati. |
| `PORT` | no | Porta HTTP. Predefinito `3000`. Su Railway e Render la piattaforma la imposta da sola: non sovrascriverla. |

`all` inoltra ogni messaggio che passa gli altri filtri. `mentions` inoltra solo:

- un messaggio che menziona l’owner (utente, ruolo dell’owner, `@everyone` o `@here`);
- una risposta a un messaggio dell’owner;
- un messaggio diretto al bot.

Se scegli `mentions` ma lasci vuoto `OWNER_USER_ID`, il bot può riconoscere solo i messaggi diretti e lo scrive nel log all’avvio.

`GUILD_IDS`, se è compilato, vale anche per i tool MCP: l’assistente vede solo quei server. Un canale di un altro server viene rifiutato. `send_dm` richiede in più che l’utente sia membro di uno dei server elencati.

### Chiave del server MCP

`MCP_API_KEY` è una password tua, diversa da `WEBHOOK_AUTHORIZATION` e dal token del bot. Generala sul computer e incollala nel pannello, non nel README e non in un commit:

```bash
openssl rand -hex 32
```

L’assistente deve mandare l’header `Authorization: Bearer <MCP_API_KEY>`. Il confronto non si ferma al primo carattere diverso. Se la variabile manca, nei log compare un avviso e il server MCP non viene avviato: `GET /health` risponde lo stesso, così il healthcheck di Railway o Render resta verde.

`ALLOW_WRITE=false` toglie i tool di scrittura. Quelli di lettura restano: `list_guilds`, `list_channels` (canali e thread), `read_messages`, `search_messages`, `get_message`, `list_members`, `get_member`.

I tool di scrittura, quando sono registrati, dicono in modo esplicito che l’azione parte **dall’account del bot, non come l’utente**: `send_message`, `reply_in_thread`, `create_thread`, `add_reaction`, `remove_reaction`, `edit_message`, `delete_message`, `pin_message`, `unpin_message`, `send_dm`. `@everyone` e `@here` nei testi inviati dal bot vengono soppressi.

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

Il processo resta connesso a Discord e apre una porta HTTP. Railway e Render la usano per lo healthcheck `GET /health`, che non chiede autenticazione. Se `MCP_API_KEY` è impostata, l’endpoint MCP è `POST /mcp`.

`/health` risponde appena il processo è in ascolto, anche mentre Discord si sta ancora connettendo. Se il login Discord fallisce, il processo esce e la piattaforma lo riavvia. Il bot non va in sleep: se la piattaforma ferma il processo quando non arrivano richieste HTTP, si interrompono sia l’inoltro sia l’MCP. Su Railway `railway.json` imposta `sleepApplication` a false.

### 3.1 Railway (strada principale)

1. Crea un account su [railway.com](https://railway.com).
2. Clicca **New Project**.
3. Se il codice è su GitHub o GitLab ed è collegato a Railway, scegli **Deploy from GitHub repo** (o GitLab) e seleziona questo repository. Railway legge `railway.json` e costruisce l’immagine dal `Dockerfile`.
4. Apri il servizio → **Variables**. Aggiungi almeno:
   - `DISCORD_TOKEN`
   - `WEBHOOK_URL`
   - `WEBHOOK_AUTHORIZATION`
   - e le opzionali che ti servono (`OWNER_USER_ID`, `GUILD_IDS`, `CHANNEL_IDS`, `FORWARD_MODE`, `FORWARD_DEBOUNCE_MS`, `FORWARD_MAX_BATCH`, `FORWARD_MAX_WAIT_MS`, `MCP_API_KEY`, `ALLOW_WRITE`).
5. Non impostare `PORT`: Railway la assegna e il processo la legge da solo.
6. Inserisci le variabili dal pannello, non nel terminale, così non restano nella cronologia dei comandi.
7. Avvia il deploy. Apri **Logs**.

All’avvio devi vedere una riga `Connesso come ...` e l’elenco dei server, per esempio:

```text
[2026-11-17T12:00:01.000Z] INFO Connesso come Soource Forwarder (123456789012345678)
[2026-11-17T12:00:01.000Z] INFO Server visibili (1):
[2026-11-17T12:00:01.000Z] INFO   • Soource (111111111111111111)
```

Se un ID in `GUILD_IDS` non è tra i server visibili, il log lo segnala: il bot non è in quel server, oppure l’ID è sbagliato.

Il comando dentro il container è `node src/index.js`. Railway controlla `GET /health` (timeout 120 secondi in `railway.json`). Quando ferma il servizio gli manda `SIGTERM`: il bot smette di prendere messaggi nuovi, invia i gruppi ancora in attesa, chiude la porta HTTP, aspetta qualche secondo gli invii già partiti e si chiude. Lo stesso succede con `SIGINT`. Se il processo esce con un errore, Railway lo riavvia fino a 10 volte.

#### Dominio pubblico e URL MCP

L’inoltro al webhook non ha bisogno di un dominio. Il server MCP sì, se l’assistente non gira nella stessa rete privata di Railway.

1. Nel servizio Railway apri **Settings**.
2. Apri **Networking**.
3. Clicca **Generate Domain**.
4. Railway assegna un dominio, per esempio `soource-discord-forwarder-production.up.railway.app`.

L’URL da dare all’assistente è:

```text
https://<dominio>/mcp
```

Header obbligatorio, con la chiave che hai messo in `MCP_API_KEY`:

```text
Authorization: Bearer <MCP_API_KEY>
```

`/health` non vuole questo header. Un controllo rapido dal browser o da un altro computer: `https://<dominio>/health` risponde con un JSON `{"ok":true,...}`. `discord` è `true` quando il bot è connesso; `mcp` è `true` quando la chiave è impostata.

Esempio di configurazione per un client MCP:

```json
{
  "mcpServers": {
    "soource-discord": {
      "url": "https://<dominio>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

Sostituisci `<dominio>` e `<MCP_API_KEY>` con i valori veri. Non committare la chiave. Il trasporto è Streamable HTTP, senza sessione: ogni richiesta è indipendente e porta l’header. I messaggi che l’assistente fa inviare partono dall’account del bot.

Se non generi il dominio, l’inoltro funziona lo stesso. Senza `MCP_API_KEY` nei log resta l’avviso che il server MCP non è partito, e `/health` continua a rispondere.

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

Render va bene se non usi Railway. Serve un **Web Service** sempre acceso: il processo tiene la connessione a Discord e risponde a `/health` e, se hai impostato `MCP_API_KEY`, a `/mcp`. Un piano che va in sleep interrompe sia l’inoltro sia l’MCP. `render.yaml` propone `starter`.

1. Accedi su [dashboard.render.com](https://dashboard.render.com).
2. Se il repository è su GitHub o GitLab, clicca **New → Blueprint** e collega il repository. Render legge `render.yaml` e crea un web service Docker chiamato `soource-discord-forwarder`, con health check `/health`.
3. Quando te lo chiede, compila `DISCORD_TOKEN`, `WEBHOOK_URL`, `WEBHOOK_AUTHORIZATION` e, se vuoi l’MCP, `MCP_API_KEY`. `FORWARD_MODE` è già `all` e `ALLOW_WRITE` è già `true`: cambiali nel pannello se ti servono altri valori.
4. Aggiungi `OWNER_USER_ID`, `GUILD_IDS` e `CHANNEL_IDS` solo se ti servono. Lasciali vuoti per non filtrare. Non impostare `PORT`: Render la assegna.
5. Scegli un piano che tenga il servizio acceso. Conferma il deploy.
6. Apri i **Logs** e controlla `Connesso come` e l’elenco dei server, come su Railway.
7. L’URL pubblico del web service è il dominio MCP. L’endpoint è `https://<dominio-render>/mcp`, con lo stesso header `Authorization: Bearer <MCP_API_KEY>` descritto per Railway. `https://<dominio-render>/health` risponde senza chiave.

#### Creare il web service a mano

Se non vuoi il Blueprint: **New → Web Service**.

- **Environment**: Docker, con il `Dockerfile` di questo repository.
- Oppure **Environment**: Node, **Build Command** `npm ci`, **Start Command** `node src/index.js`.
- **Health Check Path**: `/health`.

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
docker run --rm --env-file .env -p 3000:3000 soource-discord-forwarder
```

`--env-file` legge il `.env` locale. L’immagine non contiene quel file. `-p 3000:3000` pubblica la porta: `http://127.0.0.1:3000/health` e, se hai messo `MCP_API_KEY`, `http://127.0.0.1:3000/mcp`. Senza `-p` l’inoltro funziona lo stesso, ma dal computer non raggiungi l’HTTP del container.

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

`npm test` non parla con Discord e non usa il token: controlla i filtri, il JSON, il raggruppamento dei messaggi e i tentativi del webhook.

`npm start` collega il bot. Nel terminale devono comparire `Avvio del bot`, `Connesso come ...` e `Server visibili`. Se il nome Soource non c’è, l’invito non è andato a buon fine.

### 4.2 Inviare un messaggio di prova

1. Usa un account Discord che **non** è l’owner, se hai impostato `OWNER_USER_ID`. I messaggi dell’owner vengono ignorati di proposito.
2. Scrivi in un canale che il bot può vedere. Se hai impostato `CHANNEL_IDS`, scrivi in uno di quei canali. Se `FORWARD_MODE` è `mentions`, menziona l’owner, rispondi a un suo messaggio, oppure scrivi un messaggio diretto al bot.
3. Nel log, dopo il silenzio impostato da `FORWARD_DEBOUNCE_MS` (subito, se è `0`), deve comparire una riga simile a:

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
| `Used disallowed intents` | Attiva **Message Content Intent**, salva, riavvia il bot. Se hai impostato `MCP_API_KEY`, attiva anche **Server Members Intent**. |
| `MCP_API_KEY non impostata` | Avviso atteso se non usi l’MCP. L’inoltro continua e `/health` risponde. `/mcp` risponde 404. |
| `401` su `/mcp` | Manca `Authorization: Bearer <MCP_API_KEY>`, lo schema non è `Bearer`, oppure la chiave non coincide. `/health` non usa questa chiave. |
| Il tool risponde `Missing Permissions` | Al ruolo del bot manca uno dei permessi di scrittura: Send Messages, Send Messages in Threads, Create Public Threads, Add Reactions, Manage Messages per i pin. |
| Un tool di scrittura non compare | `ALLOW_WRITE=false`. I tool di lettura restano. |
| Il bot è online ma `Server visibili (0)` | Non è stato invitato, oppure l’invito è stato rifiutato. Ripeti il [link di invito](#14-invitare-il-bot-nel-server-soource). |
| Il server c’è, ma i messaggi non partono | Stai scrivendo dall’account owner; il canale non è in `CHANNEL_IDS`; il server non è in `GUILD_IDS`; oppure `FORWARD_MODE=mentions` e il messaggio non menziona l’owner, non è una risposta e non è un DM. Se il messaggio è del bot, viene ignorato. |
| I messaggi arrivano in ritardo, o più messaggi in un solo JSON | È il raggruppamento: il bot aspetta `FORWARD_DEBOUNCE_MS` di silenzio nella stessa conversazione. Per un invio per messaggio, imposta `FORWARD_DEBOUNCE_MS=0`. |
| I messaggi partono con `content` vuoto | **Message Content Intent** spento, oppure il bot è stato avviato prima di attivarlo. Attivalo e riavvia. |
| `HTTP 401` o `HTTP 403` | `WEBHOOK_AUTHORIZATION` non è il valore esatto del pannello. Non deve contenere il prefisso `Authorization:`. |
| `errore di rete` o `HTTP 5xx` | Il servizio ricevente non è raggiungibile. Il bot riprova tre volte e poi continua. Controlla `WEBHOOK_URL`. |
| Un canale privato non arriva | Il ruolo del bot non può vedere quel canale. Aggiungilo ai permessi del canale. |

## Comandi

| Comando | A cosa serve |
| --- | --- |
| `npm install` | Installa le dipendenze. |
| `npm start` | Avvia il bot. |
| `npm test` | Esegue i test dei filtri, del JSON, del raggruppamento, dei tentativi HTTP, dell’autenticazione MCP e dei tool. |
| `npm run test-webhook` | Invia un payload di prova al webhook. |

Dipendenze di runtime: `discord.js` 14, `dotenv`, `@modelcontextprotocol/sdk` e `zod` (gli schemi dei tool MCP). I test usano il test runner incluso in Node e un client Discord finto: non parlano con Discord e non usano chiavi vere.

## File principali

| File | Ruolo |
| --- | --- |
| `src/index.js` | Connessione a Discord, server HTTP, log di avvio, chiusura pulita. All’arresto invia i gruppi ancora in attesa. Lo stesso client Discord serve l’inoltro e i tool MCP. |
| `src/batch.js` | Raggruppa i messaggi di una conversazione e li invia dopo il silenzio, o prima se scatta un tetto. |
| `src/mcp/http.js` | `GET /health` senza autenticazione e `POST /mcp` con Streamable HTTP. |
| `src/mcp/tools.js` | Tool Discord. Quelli di scrittura dichiarano che l’azione è del bot, non dell’utente. |
| `src/mcp/auth.js` | Controllo di `Authorization: Bearer <MCP_API_KEY>`. |
| `src/filter.js` | Regole: bot, owner, server, canale, modalità `all` / `mentions`. |
| `src/evaluate.js` | Decide se inoltrare e costruisce il JSON. |
| `src/webhook.js` | `POST` con timeout, tentativi e header `Authorization`. |
| `scripts/send-sample-webhook.js` | Payload di prova. |
| `Dockerfile` | Immagine usata da Railway e da Render. |
