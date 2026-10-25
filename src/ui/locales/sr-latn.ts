/**
 * The Serbian catalogue, Latin script, complete.
 *
 * Latin only — no Cyrillic — and the tag that addresses it is `sr-Latn`: CLDR
 * reads a bare `sr` as Cyrillic, so the bare tag is an ALIAS resolved by
 * `DEFAULT_SCRIPT` (`shared/messages.ts`) rather than the name of this file's
 * language. `sr-Cyrl` is refused, never answered from here.
 *
 * Its own module for the reason `ru.ts` gives.
 */

import type { MessageKey } from '../../shared/messages.js';

export const SR_LATN: Record<MessageKey, string> = {
  'hint.orbit': 'Prevucite za rotaciju · razmak ili desni taster + prevlačenje za pomeranje · točkić za zum · dupli klik za fokus',
  'hint.walk':
    'Prevucite da se osvrnete · kliknite na pod da odete tamo · točkić za korak napred ili nazad · razmak ili desni taster + prevlačenje za kretanje',
  'hint.scrollZoom': 'Koristite Ctrl + točkić za zum',
  'hint.scrollZoomApple': 'Koristite ⌘ + točkić za zum',
  'mark.madeWith': 'Napravljeno pomoću JEEX-a',
  'hint.walkCameras': 'Šetajte slobodno ili pritisnite PageDown i PageUp da pređete s kamere na kameru',
  'walkCameras.label': 'Kamere ture',
  'walkCameras.previous': 'Prethodna kamera',
  'walkCameras.next': 'Sledeća kamera',
  'walkCameras.position': 'Kamera {n} od {count}',
  'cameraPreview.dragToAim': 'Prevucite da usmerite',
  'hint.tour': 'Autotura: jedan neprekidni obilazak stana · kliknite na scenu da preuzmete kontrolu',
  'hint.room': '{name} · prevucite za rotaciju · dupli klik za fokus',
  'hint.tourPaused': 'Tura je pauzirana · kontrola je kod vas',
  'hint.selected': '{name} · kliknite bilo gde drugde da poništite izbor',
  'hint.fullscreenUnavailable': 'Prikaz preko celog ekrana nije dostupan u ovom pregledaču',
  'hint.faceApplied': 'Obrada zida primenjena samo na ovaj zid',
  'hint.facadeApplied': 'Obrada fasade primenjena',
  'hint.allFloorsApplied': 'Obrada poda primenjena na sve prostorije',
  'hint.allWallsApplied': 'Obrada zidova primenjena na sve prostorije',
  'hint.allWallsAppliedFacadeKept': 'Obrada zidova primenjena na sve prostorije · fasada nepromenjena',
  'hint.furnitureShown': 'Nameštaj prikazan',
  'hint.furnitureHidden': 'Prazan stan · nameštaj sakriven',
  'hint.changeRefused': 'Izmena odbijena: {message}',
  'hint.planChanged': 'Plan izmenjen · ponovo gradimo geometriju',
  'hint.noClearPath': 'Tamo nema prolaza · prvo obiđite',
  'hint.travelling': 'Idemo do prostorije „{name}“ · kliknite na scenu da preuzmete kontrolu',
  'hint.arrivedInstantly': 'Prebačeno na {name}',
  'hint.alreadyHere': 'Već ste u {name}',
  'hint.routeClosed': 'Ova ruta je zatvorena · probajte kroz vrata',
  'hint.doorClosed': 'Vrata su zatvorena · pređite mišem preko njih da ih otvorite',
  'hint.plan2d': 'Osnova stana · zidovi, vrata i prozori u razmeri',
  'hint.plan3d': 'Pogled odozgo · stan gledan direktno odozgo',

  'tour.ready': 'Tura je spremna',
  'tour.playing': 'Tura je u toku',
  'tour.paused': 'Tura je pauzirana',
  'tour.ended': 'Tura je završena',
  'tour.button.pause': 'Pauza',
  'tour.bar.label': 'Reprodukcija ture',
  'tour.bar.play': 'Pokreni turu',
  'tour.bar.pause': 'Pauziraj turu',
  'tour.bar.track': 'Pozicija u turi',
  'tour.bar.speed': 'Brzina ture {speed}',

  // The mode buttons stay as they are: `2D`, `3D` and `360` read the same way
  // in Serbian, and the bar is narrow.

  'furniture.hide': 'Sakrij nameštaj',
  'furniture.show': 'Prikaži nameštaj',
  'furniture.stateShown': 'Nameštaj: prikazan',
  'furniture.stateHidden': 'Nameštaj: sakriven',
  'furniture.label': 'Nameštaj',
  'fullscreen.enter': 'Ceo ekran',
  'fullscreen.exit': 'Izađi iz celog ekrana',
  'fullscreen.label': 'Ceo ekran',
  'camera.reset': 'Resetuj kameru',
  'controls.show': 'Prikaži kontrole',
  'controls.label': 'Kontrole',
  'mode.label': 'Režim prikaza',
  'minimap.label': 'Osnova stana · kliknite na prostoriju da odete do nje',
  'cameraPreview.label': 'Šta vidi izabrana kamera ture',
  'cameraPreview.title': 'Pogled kamere',
  'cameraPreview.lookThrough': 'Pogledaj kroz kameru',
  'hint.checkpointPlacing': 'Postavljanje kamere — kliknite na pod (prevucite da usmerite) · Esc za otkazivanje',
  'hint.assetMove': 'Prevucite za pomeranje, Q/E za okretanje, Esc za otkazivanje',
  'hint.lookThrough':
    'Pogled kroz kameru — prevucite da gledate · WASD za kretanje · Q/E za visinu · Enter za čuvanje · Esc za otkazivanje',
  'lookThrough.label': 'Pogled kroz kameru {n}',
  'lookThrough.done': 'Gotovo',
  'lookThrough.cancel': 'Otkaži',

  'live.mode.plan2d': 'Režim osnove stana',
  'live.mode.plan3d': 'Režim pogleda odozgo',
  'live.mode.orbit': 'Režim kružnog pregleda',
  'live.mode.walk': 'Režim šetnje',
  'live.mode.tour': 'Režim ture',
  'canvas.description': '{name}. Prostorije: {rooms}. {keys}',
  'canvas.keys':
    'Tasteri: W, A, S, D ili strelice za kretanje (u 360 za pomeranje); Shift za trčanje; držite razmak i prevucite za kretanje; + i - za zum tokom šetnje.',

  'panel.floorFinish': 'Obrada poda · {name}',
  'panel.wallFinish': 'Obrada zida · {name}',
  'panel.replace': 'Zameni · {name}',
  'panel.label': 'Obrada površine',
  'panel.close': 'Zatvori',
  'panel.scopeOnlyThisWall': 'Samo ovaj zid (od ugla do ugla)',
  'panel.applyAllFloors': 'Primeni na sve podove',
  'panel.applyAllRoomWalls': 'Primeni na sve zidove prostorije',
  'panel.applyAllWalls': 'Primeni na sve zidove',
  'panel.standardVariant': 'Standardna varijanta',
  'panel.replaceWithAnother': 'Zameni drugim…',
  'replacePopup.title': 'Zameni {name} sa',
  'replacePopup.close': 'Zatvori listu',
  'replacePopup.empty': 'Ništa drugo ne odgovara mestu ovog predmeta.',
  'panel.ownerFacade': 'Fasada',
  'panel.ownerExterior': 'Spolja',

  'door.close': 'Zatvori vrata',
  'door.open': 'Otvori vrata',

  'interiors.label': 'Gotovi enterijeri',
  'interiors.applied': 'Enterijer „{name}“ primenjen na ceo stan',
  'panel.interiors': 'Enterijer',

  'opening.window': 'Prozor',
  'opening.door': 'Vrata',
  'opening.entranceDoor': 'Ulazna vrata',
  'opening.passage': 'Prolaz',
  'opening.generic': 'Otvor',

  // The brand line is a name, not a phrase: it is not translated.
  'loading.eyebrow': 'JEEX / LIVE SPACE',
  'loading.title': 'Pripremamo stan',
  'loading.default': 'Učitavamo geometriju scene',
  'loading.support': 'Proveravamo podršku za renderovanje',
  'loading.scene': 'Učitavamo stan',
  'loading.geometry': 'Gradimo geometriju stana',
  'loading.furniture': 'Raspoređujemo nameštaj i svetla',
  'loading.ready': 'Spremno',

  'error.eyebrow': 'PRIKAZ NIJE DOSTUPAN',
  'error.title': 'Scena nije mogla da se učita',
  'error.body': 'Probajte ponovo da učitate demo.',
  'error.retry': 'Probaj ponovo',
  'error.noWebglTitle': 'Interaktivni 3D nije dostupan',
  'error.noWebglBody': 'Ovaj pregledač ne podržava WebGL. Prikazujemo prezentacioni pregled.',
  'error.unknown': 'Nepoznata greška scene',
  'error.notReady': 'Prikaz još nije spreman',
  'error.contextLostTitle': 'Prikaz 3D je prekinut',
  'error.contextLostBody': 'Pregledač je oslobodio grafički kontekst. Stan se vraća sam; ako ne, kliknite „Probaj ponovo“.',

  'capture.disclosure': 'Vizuelizacija 3D modela, nije fotografija',

  'notice.degraded': 'Deo demo objekata prikazan je kao zamena',
  'viewer.label': 'Prikaz stana JEEX',
  'canvas.label': 'Interaktivna 3D scena stana',
  'canvas.fallbackLabel': 'Prezentacioni pregled scene stana',
  'settings.label': 'Podešavanja',
  'settings.title': 'Podešavanja prikaza',
  'settings.temperature': 'Temperatura svetla',
  'settings.original': 'Originalno',
  'settings.temperatureValue': '{kelvin} K · {tone}',
  'settings.warm': 'toplo',
  'settings.neutral': 'neutralno',
  'settings.cool': 'hladno',
};
