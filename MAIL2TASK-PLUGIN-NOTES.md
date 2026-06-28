# Mail2Task Super Productivity Plugin - Recherche und Architektur-Notizen

Stand: 2026-06-28

## Festlegung

- Das Plugin soll ein Community-Plugin fuer Super Productivity werden.
- Externer Service ist keine Option.
- Zielplattformen sind Desktop und Mobile. Die Webapp wird nicht unterstuetzt.
- IMAP ist gesetzt, weil es die allgemeinste Mailbox-Schnittstelle ist.
- Das Plugin soll Mails aus einem dedizierten Postfach lesen und daraus Super-Productivity-Tasks erzeugen.

## Issue-Ziel

Issue #7511 beschreibt:

- Zugriff auf ein Postfach via IMAP, moeglichst read-only.
- Postfach auf neue Mails ueberwachen.
- Aus eingehenden Mails neue Tasks erzeugen.
- Optional Mails nach Verarbeitung loeschen.

Referenz: https://github.com/super-productivity/super-productivity/issues/7511

## Super-Productivity-Plugin-Modell

Plugins bestehen aus:

- `manifest.json`
- optionalem host-seitigem `plugin.js`
- optionalem iframe-UI via `index.html`

Wichtige Plugin-APIs fuer Mail2Task:

- `PluginAPI.addTask()` zum Erzeugen der Tasks.
- `PluginAPI.persistDataSynced()` / `loadSyncedData()` fuer nicht-sensitive Plugin-Daten.
- `PluginAPI.startOAuthFlow()` / `getOAuthToken()` nur fuer OAuth-basierte Provider.
- `PluginAPI.executeNodeScript()` fuer Node-Code in der Electron-Desktop-App.
- `plugin.onReady()` fuer Startup-Logik mit Node-Bridge.
- `plugin.onUnload()` zum Aufraeumen von Timern/Listeners.

Referenz: https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md

## Ergebnisse zur Secret-Speicherung

Super Productivity hat mehrere Credential-Pfade, aber keinen offensichtlichen generischen Secret-Store fuer Community-Plugins.

### Sync-Credentials

Sync-Provider speichern private Konfiguration in einer eigenen lokalen IndexedDB:

- DB: `sup-sync`
- Store: `credentials`
- Key-Prefix: `__sp_cred_`
- lokale Speicherung, Migration aus alter `pf`-DB

Das ist app-intern fuer Sync-Provider und nicht als freie Plugin-API verfuegbar.

Quellen:

- https://github.com/super-productivity/super-productivity/blob/master/src/app/op-log/sync-providers/credential-store.service.ts
- https://github.com/super-productivity/super-productivity/blob/master/src/app/op-log/sync-providers/provider.const.ts

### Plugin-OAuth

Fuer Plugins gibt es eine lokale OAuth-Token-Speicherung:

- DB: `sup-plugin-oauth`
- Store: `tokens`
- Kommentar im Code: local-only, nicht Teil des Sync-Systems
- jedes Geraet authentifiziert sich separat
- Zugriff ueber `startOAuthFlow()`, `getOAuthToken()`, `clearOAuthToken()`

Das passt fuer OAuth-Provider wie Google Calendar, aber nicht direkt fuer generische IMAP-Passwoerter oder App-Passwoerter.

Quellen:

- https://github.com/super-productivity/super-productivity/blob/master/src/app/plugins/oauth/plugin-oauth-token-store.ts
- https://github.com/super-productivity/super-productivity/blob/master/src/app/plugins/oauth/plugin-oauth-bridge.service.ts
- https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-dev/google-calendar-provider/src/plugin.ts

### Issue-Provider-Konfiguration

Einige historische Built-in-Integrationen wie Jira und CalDAV haben Passwortfelder direkt in ihren Konfigurationsmodellen. Moderne Issue-Provider-Plugins speichern ihre Konfiguration in `pluginConfig`.

Diese Daten sind jedoch persistente `ISSUE_PROVIDER`-Entities. Ein IMAP-Passwort in `pluginConfig` waere daher ungeeignet, weil es in normale App-Daten, Sync, Export oder Backups geraten kann.

Quellen:

- https://github.com/super-productivity/super-productivity/blob/master/src/app/features/issue/providers/jira/jira.model.ts
- https://github.com/super-productivity/super-productivity/blob/master/src/app/features/issue/providers/caldav/caldav.model.ts
- https://github.com/super-productivity/super-productivity/blob/master/src/app/features/issue/store/issue-provider.actions.ts

## Node Execution

`nodeExecution` ist fuer Desktop relevant:

- nur Electron/Desktop
- native Consent-Dialoge
- Grants sind nur fuer die aktuelle App-Session gueltig
- Grants werden im Speicher gehalten und an `webContents` gebunden
- Community-Plugins werden als unverified third-party code dargestellt
- Default im Consent-Dialog ist Deny
- bei Zustimmung kann das Plugin Node-Code mit Zugriff auf lokale Dateien und System ausfuehren

Quellen:

- https://github.com/super-productivity/super-productivity/blob/master/electron/plugin-node-executor.ts
- https://github.com/super-productivity/super-productivity/blob/master/src/app/plugins/plugin-bridge.service.ts

Konsequenz:

- Desktop-IMAP ist ueber `nodeExecution` realistisch.
- Das ist aber ein starker Trust-Schritt fuer Nutzer.
- Das Plugin muss minimalen, gut auditierbaren Node-Code haben.
- Keine Secrets in Logs, keine Shell-Kommandos, keine dynamische Codeausfuehrung.

## Backend-Konsequenzen fuer IMAP

IMAP braucht TCP/TLS-Sockets. Das ist in normalem Browser-/iframe-JavaScript nicht verfuegbar.

### Desktop

Desktop-Variante:

- IMAP-Client laeuft ueber `executeNodeScript()`.
- Polling statt dauerhafter IMAP-IDLE-Verbindung fuer den MVP.
- Credentials muessen lokal und nicht synchronisiert gespeichert werden.
- Wenn es keinen generischen Plugin-Secret-Store gibt, muss entweder:
  - der Nutzer das Passwort pro Session eingeben,
  - oder Super Productivity erhaelt upstream eine Plugin-Secret-API,
  - oder das Plugin nutzt einen Desktop-spezifischen lokalen Speicher ueber Node, was wieder klar dokumentiert und consent-gebunden sein muss.

### Mobile

Mobile ist der schwierigere Teil:

- `nodeExecution` ist Desktop-only.
- Mobile WebView/Browser-JavaScript hat keine generischen TCP/TLS-Sockets fuer IMAP.
- Ohne externen Service braucht Mobile eine native Bruecke.
- Realistisch waere ein upstream/Capacitor-nativer IMAP-Bridge-Mechanismus fuer Android/iOS oder eine Super-Productivity-Plugin-API, die Mobile-Plugins sichere native Netzwerkfunktionen bereitstellt.

Konsequenz:

- Ein reines Community-Zip-Plugin kann Desktop-IMAP eher leisten als Mobile-IMAP.
- Fuer echtes Desktop- und Mobile-Only mit IMAP braucht es wahrscheinlich Upstream-Unterstuetzung in Super Productivity fuer Mobile.
- Die Webapp kann bewusst ausgeschlossen werden.

## Secret-Anforderung fuer Mail2Task

Fuer IMAP-Credentials gilt:

- nicht in `persistDataSynced()`
- nicht in `pluginConfig`
- nicht in Task-Notizen
- nicht in Logs
- nicht in exportierbaren Diagnosedaten

Gewuenschte Upstream-API:

```ts
PluginAPI.saveSecret(key: string, value: string): Promise<void>;
PluginAPI.loadSecret(key: string): Promise<string | null>;
PluginAPI.deleteSecret(key: string): Promise<void>;
```

Eigenschaften:

- local-only
- nicht synchronisiert
- pro Plugin-ID isoliert
- Desktop: OS-Keychain oder Electron `safeStorage`
- Mobile: Keychain/Keystore
- Web: nicht unterstuetzt oder nur mit deutlicher Warnung

## MVP-Vorschlag

### Verhalten

1. Nutzer konfiguriert IMAP-Host, Port, TLS, Username, Mailbox und Polling-Intervall.
2. Nutzer testet die Verbindung.
3. Plugin pollt read-only neue Mails.
4. Plugin erzeugt pro neuer Mail genau eine Task.
5. Task-Titel: `Absender: Betreff`.
6. Task-Notiz: Empfangsdatum, Message-ID, From, To, Subject, Plaintext-Auszug.
7. Deduplizierung ueber `Message-ID` plus IMAP `UIDVALIDITY:UID`.
8. Mails werden im MVP nicht geloescht und nicht verschoben.

### Nicht im MVP

- Mail loeschen.
- Attachments importieren.
- HTML ungefiltert uebernehmen.
- Dauerhafte IDLE-Verbindung.
- Webapp-Unterstuetzung.
- Externer Service.

## Sicherheitsstandards

- TLS standardmaessig erzwingen.
- Zertifikatspruefung nicht deaktivierbar machen, ausser eventuell in einem klar markierten Dev-Modus.
- IMAP read-only als Default.
- Destruktive Aktionen spaeter nur opt-in und mit Warnung.
- Mail-Inhalte als untrusted input behandeln.
- HTML-Mails nicht rendern; Plaintext extrahieren.
- Mailgroesse und Body-Laenge begrenzen.
- Header robust parsen und normalisieren.
- Keine Secrets oder Mailinhalte in Logs.
- Backoff und Rate-Limits bei Verbindungsfehlern.
- Verarbeitung idempotent machen.

## Offene technische Fragen

1. Gibt es oder soll es eine offizielle Plugin-Secret-API geben?
2. Kann eine Community-Plugin-Verteilung auf Mobile native IMAP-Faehigkeiten bekommen?
3. Soll Mobile erst als spaetere Phase kommen, falls Upstream-Unterstuetzung noetig ist?
4. Wie soll das Plugin zwischen Desktop- und Mobile-Credentials unterscheiden?
5. Soll das Plugin IMAP-Passwoerter pro Session akzeptieren, solange kein Secret-Store existiert?

## Empfehlung

Die saubere Zielarchitektur ist:

- Desktop: IMAP ueber `nodeExecution`, Credentials local-only ueber eine neue Plugin-Secret-API.
- Mobile: IMAP ueber native Android/iOS-Bruecke, Credentials in Keystore/Keychain.
- Web: explizit nicht unterstuetzt.

Falls Upstream-Aenderungen moeglich sind, sollte zuerst eine kleine, generische Secret-API fuer Plugins vorgeschlagen werden. Danach kann Mail2Task darauf aufbauen, ohne IMAP-Passwoerter in synchronisierte oder exportierbare App-Daten zu schreiben.
