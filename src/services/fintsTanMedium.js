// Setzt die Gerätebezeichnung (TAN-Medium). lib-fints akzeptiert nur Namen aus der von der Bank gemeldeten Liste
// (activeTanMedia); fehlt die Liste, wird der Name aufgenommen und trotzdem gesetzt.
export function setzeTanMedium(config, name) {
  if (!name) return;
  const tm = config.selectedTanMethod;
  if (tm && !tm.activeTanMedia?.includes(name)) tm.activeTanMedia = [...(tm.activeTanMedia ?? []), name];
  config.selectTanMedia(name);
}
