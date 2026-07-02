# Mail2Task Super Productivity Plugin - Recherche und Architektur-Notizen

Stand: 2026-06-29

Update 2026-06-29: Das offene Storage-Problem (sichere Credential-Speicherung) ist upstream geloest. PR #8633 fuegt eine generische Plugin-Secret-API hinzu. Details unten in "Ergebnisse zur Secret-Speicherung".

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

Super Productivity hatte lange mehrere Credential-Pfade, aber keinen generischen Secret-Store fuer Community-Plugins. Mit PR #8633 gibt es jetzt eine offizielle Plugin-Secret-API, die genau diese Luecke schliesst. Damit ist der zentrale Blocker fuer Mail2Task auf Desktop geloest.

### Plugin-Secret-API (NEU, loest das Storage-Problem)

Upstream-PR: https://github.com/super-productivity/super-productivity/pull/8633

Die API stellt drei Methoden auf `PluginAPI` bereit:

```ts
PluginAPI.setSecret(key: string, value: string): Promise<void>;
PluginAPI.getSecret(key: string): Promise<string | null>;
PluginAPI.deleteSecret(key: string): Promise<void>;
```

Eigenschaften laut PR:

- eigene IndexedDB `sup-plugin-secrets`, Store `secrets` (Schema-Version 1)
- analog zum bestehenden OAuth-Token-Store aufgebaut
- nie synchronisiert: ausgeschlossen aus Sync, Operation-Log, Export und Backup
- pro Plugin-ID isoliert ueber `composeId` / `isPluginIdMatch`, kein Cross-Plugin-Zugriff
- pro Geraet lokal: Credentials wandern nicht auf andere Geraete
- werden beim Deinstallieren des Plugins mitsamt OAuth-Tokens geloescht
- aktuell Plaintext at rest, mit dokumentiertem Pfad fuer spaetere OS-Keychain-Verschluesselung
- Limit pro Secret: `MAX_PLUGIN_SECRET_LENGTH = 16 * 1024` (16 KB)

Registrierung im `PluginBridgeService` reicht die `pluginId` an den `PluginSecretService` durch; das Plugin sieht nur `key`/`value`. Damit ist die in diesem Dokument geforderte Upstream-API erfuellt. Einziger Unterschied zur urspruenglichen Wunschliste: die Methoden heissen `set/get/deleteSecret` statt `save/loadSecret/deleteSecret`.

Offene Punkte trotz Fix:

- Plaintext at rest heisst, dass ein IMAP-Passwort auf Desktop weiterhin lokal unverschluesselt liegt, bis die Keychain-Anbindung kommt. Akzeptabel fuer MVP, aber im Plugin dokumentieren.
- Die API ist generisch (Browser-IndexedDB). Ob Mobile-Builds sie genauso bereitstellen, muss noch geprueft werden, ist aber unabhaengig vom verbleibenden Mobile-IMAP-Problem.

Quellen:

- https://github.com/super-productivity/super-productivity/pull/8633
- Files im PR: `packages/plugin-api/src/types.ts`, `plugin-secret-store.ts`, `plugin-secret.service.ts`, `plugin-bridge.service.ts`

### Bisheriger Stand (vor PR #8633)

Super Productivity hatte mehrere Credential-Pfade, aber keinen offensichtlichen generischen Secret-Store fuer Community-Plugins.

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
- GELOEST durch PR #8633: Die Plugin-Secret-API (`setSecret`/`getSecret`/`deleteSecret`) bietet genau diesen local-only, nicht synchronisierten Speicher. Siehe "Plugin-Secret-API" oben.
- Der frueher diskutierte Fallback ist damit hinfaellig (Passwort pro Session, eigener Node-Speicher). Nur falls die API in einer Ziel-Build-Version noch nicht verfuegbar ist, bleibt das Pro-Session-Passwort als Notloesung.

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

Upstream-API (jetzt vorhanden, PR #8633):

```ts
PluginAPI.setSecret(key: string, value: string): Promise<void>;
PluginAPI.getSecret(key: string): Promise<string | null>;
PluginAPI.deleteSecret(key: string): Promise<void>;
```

Eigenschaften (Ist-Zustand laut PR):

- local-only, eigene IndexedDB `sup-plugin-secrets`
- nicht synchronisiert (aus Sync, Export, Backup ausgeschlossen)
- pro Plugin-ID isoliert
- Desktop/Mobile: aktuell Plaintext at rest, OS-Keychain als spaeterer Ausbau geplant
- Web: nicht im Fokus dieses Plugins (Webapp ohnehin ausgeschlossen)

Damit erfuellt die API alle obigen Secret-Anforderungen. Mail2Task speichert das IMAP-Passwort ueber `setSecret`, nicht in `persistDataSynced()` oder `pluginConfig`.

## MVP-Vorschlag

### Verhalten

1. Nutzer konfiguriert IMAP-Host, Port, TLS, Username, Mailbox und Polling-Intervall.
2. Nutzer testet die Verbindung.
3. Plugin pollt read-only neue Mails.
4. Plugin erzeugt pro neuer Mail genau eine Task.
5. Task-Titel: `Absender: bereinigter Betreff`.
6. Task-Notiz: Markdown mit konfigurierbaren Mail-Metadaten und Plaintext-Auszug.
7. Deduplizierung ueber `accountKey + mailbox + UIDVALIDITY + UID`; `Message-ID` wird als Zusatz-Metadatum gespeichert.
8. Mails werden im MVP nicht geloescht und nicht verschoben.

### Mail-Parsing und Task-Mapping

Mail2Task verarbeitet im MVP die Mail selbst als Task-Quelle, nicht ihre Dateianhaenge.

- `Subject` wird fuer den Task-Titel normalisiert.
- Bekannte Antwort-/Weiterleitungs-Prefixe am Anfang werden wiederholt entfernt, z.B. `Re:`, `AW:`, `Fwd:`, `FW:`, `WG:`.
- Der originale Betreff kann weiterhin als Mail-Metadatum in den Notes angezeigt werden.
- Wenn `text/plain` vorhanden ist, wird dieser Body bevorzugt.
- Wenn nur `text/html` vorhanden ist, wird HTML zu Plaintext konvertiert.
- HTML wird nicht gerendert oder ungefiltert in Notes uebernommen.
- Body-Laenge wird begrenzt.
- Mail-Text wird als untrusted input behandelt und fuer Markdown geeignet escaped bzw. als sicherer Markdown-Block formatiert.

Die Task-Notes nutzen Markdown, weil Super Productivity Task-Notes als Markdown rendern kann. Die genaue Anzeige der Mail-Metadaten soll konfigurierbar sein.

Vorgeschlagene konfigurierbare Metadata-Felder fuer Notes:

- Empfangsdatum
- From
- To
- Cc
- Subject original
- Message-ID
- IMAP-Mailbox
- IMAP UIDVALIDITY/UID

Default fuer den MVP:

- Empfangsdatum: an
- From: an
- To: an
- Subject original: an, falls der Titel bereinigt wurde
- Message-ID: an
- Cc: aus
- IMAP-Mailbox: aus
- IMAP UIDVALIDITY/UID: aus

Beispiel fuer Notes:

```md
## Email

- From: Name <mail@example.org>
- To: tasks@example.org
- Received: 2026-06-29 14:35
- Subject: AW: Fwd: Rechnung Juni
- Message-ID: <...>

## Body

> Hallo,
> bitte Rechnung pruefen ...
```

### Nicht im MVP

- Mail loeschen.
- Attachments importieren oder in Notes auflisten.
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

1. ~~Gibt es oder soll es eine offizielle Plugin-Secret-API geben?~~ GELOEST durch PR #8633 (`setSecret`/`getSecret`/`deleteSecret`). Offen bleibt nur: Plaintext at rest bis Keychain-Anbindung kommt.
2. Kann eine Community-Plugin-Verteilung auf Mobile native IMAP-Faehigkeiten bekommen?
3. Soll Mobile erst als spaetere Phase kommen, falls Upstream-Unterstuetzung noetig ist?
4. Wie soll das Plugin zwischen Desktop- und Mobile-Credentials unterscheiden?
5. ~~Soll das Plugin IMAP-Passwoerter pro Session akzeptieren, solange kein Secret-Store existiert?~~ Hinfaellig, da der Secret-Store jetzt existiert. Pro-Session-Eingabe nur noch als Notloesung, falls die API in der Ziel-Build-Version fehlt.
6. Ab welcher Super-Productivity-Version ist die Plugin-Secret-API verfuegbar, und gilt sie auch fuer Mobile-Builds?

## Empfehlung

Die saubere Zielarchitektur ist:

- Desktop: IMAP ueber `nodeExecution`, Credentials local-only ueber die Plugin-Secret-API (`setSecret`/`getSecret`/`deleteSecret`, PR #8633).
- Mobile: IMAP ueber native Android/iOS-Bruecke, Credentials in Keystore/Keychain. Secret-Speicherung kann dieselbe Plugin-Secret-API nutzen, sofern sie im Mobile-Build verfuegbar ist (noch zu pruefen).
- Web: explizit nicht unterstuetzt.

Die zuvor geforderte generische Secret-API ist mit PR #8633 vorhanden. Mail2Task kann jetzt darauf aufbauen, ohne IMAP-Passwoerter in synchronisierte oder exportierbare App-Daten zu schreiben. Naechster konkreter Schritt: Verfuegbarkeit der API in der Ziel-Version pruefen und das IMAP-Passwort konsequent ueber `setSecret`/`getSecret` halten. Der verbleibende echte Blocker ist nicht mehr die Secret-Speicherung, sondern das Mobile-IMAP-Transportproblem (TCP/TLS ohne nodeExecution).
