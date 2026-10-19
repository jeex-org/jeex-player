/**
 * The Russian catalogue, complete.
 *
 * `Record<MessageKey, string>` rather than a `Partial`: the COMPILER is what
 * keeps it complete, so a new English key does not silently ship as English to
 * a Russian-speaking host.
 *
 * Its own module (`../messages.ts` is the engine, not the data): seven
 * catalogues in one file would take it past the 700-line limit
 * `scripts/size-check.ts` holds every module to, and a translation change that
 * rewrites ONE language then touches exactly one file.
 */

import type { MessageKey } from '../../shared/messages.js';

export const RU: Record<MessageKey, string> = {
  'hint.orbit': 'Перетаскивайте, чтобы вращать · пробел или правая кнопка + перетаскивание — сдвиг · колесо — зум · двойной клик — фокус',
  'hint.walk':
    'Перетаскивайте, чтобы осмотреться · клик по полу — перейти туда · колесо — шаг вперёд или назад · пробел или правая кнопка + перетаскивание — движение',
  'hint.scrollZoom': 'Чтобы масштабировать, используйте Ctrl + прокрутку',
  'hint.scrollZoomApple': 'Чтобы масштабировать, используйте ⌘ + прокрутку',
  'mark.madeWith': 'Сделано в JEEX',
  'hint.walkCameras': 'Гуляйте свободно или нажимайте PageDown и PageUp, чтобы переходить между камерами',
  'walkCameras.label': 'Камеры тура',
  'walkCameras.previous': 'Предыдущая камера',
  'walkCameras.next': 'Следующая камера',
  'walkCameras.position': 'Камера {n} из {count}',
  'cameraPreview.dragToAim': 'Перетащите, чтобы навести',
  'hint.tour': 'Автотур: один непрерывный проход по квартире · нажмите на сцену, чтобы взять управление',
  'hint.room': '{name} · перетаскивайте, чтобы вращать · двойной клик — фокус',
  'hint.tourPaused': 'Тур на паузе · управление у вас',
  'hint.selected': '{name} · нажмите в стороне, чтобы снять выделение',
  'hint.fullscreenUnavailable': 'Полноэкранный режим недоступен в этом браузере',
  'hint.faceApplied': 'Отделка применена только к этой стене',
  'hint.facadeApplied': 'Отделка фасада применена',
  'hint.allFloorsApplied': 'Отделка пола применена ко всем помещениям',
  'hint.allWallsApplied': 'Отделка стен применена ко всем помещениям',
  'hint.allWallsAppliedFacadeKept': 'Отделка стен применена ко всем помещениям · фасад не изменён',
  'hint.furnitureShown': 'Мебель показана',
  'hint.furnitureHidden': 'Пустая квартира · мебель скрыта',
  'hint.changeRefused': 'Изменение отклонено: {message}',
  'hint.planChanged': 'План изменён · перестраиваем геометрию',
  'hint.noClearPath': 'Туда нет прохода · сначала обойдите',
  'hint.travelling': 'Идём в помещение «{name}» · нажмите на сцену, чтобы взять управление',
  'hint.arrivedInstantly': 'Перенос в {name}',
  'hint.alreadyHere': 'Вы уже в {name}',
  'hint.routeClosed': 'Этот маршрут закрыт · попробуйте пройти через дверной проём',
  'hint.doorClosed': 'Дверь закрыта · наведите на неё, чтобы открыть',
  'hint.plan2d': 'План этажа · стены, двери и окна в масштабе',
  'hint.plan3d': 'Вид сверху · квартира строго сверху',

  'tour.ready': 'Тур готов',
  'tour.playing': 'Идёт тур',
  'tour.paused': 'Тур на паузе',
  'tour.ended': 'Тур завершён',
  'tour.button.pause': 'Пауза',
  'tour.bar.label': 'Воспроизведение тура',
  'tour.bar.play': 'Запустить тур',
  'tour.bar.pause': 'Поставить тур на паузу',
  'tour.bar.track': 'Позиция в туре',
  'tour.bar.speed': 'Скорость тура {speed}',

  // The mode buttons stay as they are: `2D`, `3D` and `360` are read the same
  // way in Russian, and the bar is narrow.

  'furniture.hide': 'Скрыть мебель',
  'furniture.show': 'Показать мебель',
  'furniture.stateShown': 'Мебель: показана',
  'furniture.stateHidden': 'Мебель: скрыта',
  'furniture.label': 'Мебель',
  'fullscreen.enter': 'Во весь экран',
  'fullscreen.exit': 'Выйти из полноэкранного режима',
  'fullscreen.label': 'Полный экран',
  'camera.reset': 'Сбросить камеру',
  'controls.show': 'Показать элементы управления',
  'controls.label': 'Элементы управления',
  'mode.label': 'Режим просмотра',
  'minimap.label': 'План этажа · нажмите на помещение, чтобы дойти до него',
  'cameraPreview.label': 'Что видит выбранная камера тура',
  'cameraPreview.title': 'Вид камеры',
  'cameraPreview.lookThrough': 'Посмотреть через камеру',
  'hint.checkpointPlacing': 'Размещение камеры — щёлкните по полу (потяните, чтобы направить) · Esc — отмена',
  'hint.assetMove': 'Перетащите, чтобы переместить, Q/E — повернуть, Esc — отмена',
  'hint.lookThrough': 'Вид через камеру — тяните, чтобы осмотреться · WASD — движение · Q/E — высота · Enter — сохранить · Esc — отмена',
  'lookThrough.label': 'Вид через камеру {n}',
  'lookThrough.done': 'Готово',
  'lookThrough.cancel': 'Отмена',

  'live.mode.plan2d': 'Режим плана этажа',
  'live.mode.plan3d': 'Режим вида сверху',
  'live.mode.orbit': 'Режим кругового обзора',
  'live.mode.walk': 'Режим прогулки',
  'live.mode.tour': 'Режим тура',
  'canvas.description': '{name}. Комнаты: {rooms}. {keys}',
  'canvas.keys':
    'Клавиши: W, A, S, D или стрелки — движение (в режиме 360 — сдвиг); Shift — бег; пробел и перетаскивание — перемещение; + и - — масштаб на прогулке.',

  'panel.floorFinish': 'Отделка пола · {name}',
  'panel.wallFinish': 'Отделка стен · {name}',
  'panel.replace': 'Заменить · {name}',
  'panel.label': 'Отделка поверхности',
  'panel.close': 'Закрыть',
  'panel.scopeOnlyThisWall': 'Только эта стена (от угла до угла)',
  'panel.applyAllFloors': 'Применить ко всем полам',
  'panel.applyAllRoomWalls': 'Применить ко всем стенам помещений',
  'panel.applyAllWalls': 'Применить ко всем стенам',
  'panel.standardVariant': 'Стандартный вариант',
  'panel.ownerFacade': 'Фасад',
  'panel.ownerExterior': 'Снаружи',

  'door.close': 'Закрыть дверь',
  'door.open': 'Открыть дверь',

  'interiors.label': 'Готовые интерьеры',
  'interiors.applied': 'Интерьер «{name}» применён ко всей квартире',
  'panel.interiors': 'Интерьер',

  'opening.window': 'Окно',
  'opening.door': 'Дверь',
  'opening.entranceDoor': 'Входная дверь',
  'opening.passage': 'Проём',
  'opening.generic': 'Проём',

  // The brand line is a name, not a phrase: it is not translated.
  'loading.eyebrow': 'JEEX / LIVE SPACE',
  'loading.title': 'Готовим квартиру',
  'loading.default': 'Загружаем геометрию сцены',
  'loading.support': 'Проверяем поддержку рендеринга',
  'loading.scene': 'Загружаем квартиру',
  'loading.geometry': 'Строим геометрию квартиры',
  'loading.furniture': 'Расставляем мебель и свет',
  'loading.ready': 'Готово',

  'error.eyebrow': 'ПРОСМОТР НЕДОСТУПЕН',
  'error.title': 'Не удалось загрузить сцену',
  'error.body': 'Попробуйте загрузить демонстрацию ещё раз.',
  'error.retry': 'Попробовать снова',
  'error.noWebglTitle': 'Интерактивный 3D недоступен',
  'error.noWebglBody': 'Этот браузер не предоставляет WebGL. Показываем презентационное превью.',
  'error.unknown': 'Неизвестная ошибка сцены',
  'error.notReady': 'Просмотр ещё не готов',
  'error.contextLostTitle': 'Показ 3D прерван',
  'error.contextLostBody': 'Браузер освободил графический контекст. Квартира вернётся сама; если нет — нажмите «Попробовать снова».',

  'capture.disclosure': 'Визуализация 3D-модели, не фотография',

  'notice.degraded': 'Часть демонстрационных объектов показана заглушками',
  'viewer.label': 'Просмотр квартиры JEEX',
  'canvas.label': 'Интерактивная 3D-сцена квартиры',
  'canvas.fallbackLabel': 'Презентационное превью сцены квартиры',
};
