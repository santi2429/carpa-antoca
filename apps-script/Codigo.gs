/**
 * Carpa Ántoca – Informe nocturno.
 * Al cerrar el día en la app (o a las 11 p. m. si nadie cerró): lee las ventas del día en Firebase,
 * actualiza el Excel del mes (Google Sheets con gráficos) y envía por correo el informe con gráficas,
 * el Excel del día y el Excel del mes.
 * Corre en la cuenta de Google de Santiago (script.google.com). Gratis, sin tarjeta.
 */
const CONFIG = {
  PROYECTO: 'carpa-antoca',
  DESTINATARIOS: ['__DEST__'],
  HORA: 23, MINUTO: 0,                       // respaldo: si a esta hora nadie cerró el día, se envía igual
  TZ: 'America/Bogota',
  CARPETA: 'Carpa Ántoca – Informes',        // carpeta en Google Drive
  BASE: 200000,
  MEDIOS: ['Efectivo', 'Transferencia'],
};
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SEMANA = [1, 2, 3, 4, 5, 6, 0];
const pesos = n => '$' + Math.round(n).toLocaleString('es-CO');

// ---------- Ejecutar UNA vez para programar el envío diario ----------
function programarEnvioDiario() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'informeNocturno').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('informeNocturno').timeBased().atHour(CONFIG.HORA).nearMinute(CONFIG.MINUTO).everyDays(1).inTimezone(CONFIG.TZ).create();
}

// ---------- Disparo desde la app al cerrar el día ----------
// Se publica como aplicación web. Solo envía si el cierre de esa fecha existe en Firebase, se guardó hace
// menos de 15 minutos y no se ha enviado ya: así nadie puede usar el enlace para mandar correos de más.
function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const fecha = String(JSON.parse(e.postData.contents || '{}').fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return salida('fecha inválida');
    const cierre = leerDoc('cierres/' + fecha);
    if (!cierre || !cierre.ts || Date.now() - cierre.ts > 15 * 60 * 1000) return salida('sin cierre reciente');
    const props = PropertiesService.getScriptProperties();
    if (Number(props.getProperty('enviado_' + fecha)) === cierre.ts) return salida('ya enviado');
    enviarInforme(fecha);
    props.setProperty('enviado_' + fecha, String(cierre.ts));
    return salida('enviado');
  } finally { lock.releaseLock(); }
}
const salida = t => ContentService.createTextOutput(t);

// ---------- Respaldo a las 11 p. m.: solo si hoy no se envió ----------
function informeNocturno() {
  const fecha = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('enviado_' + fecha)) return;
    if (enviarInforme(fecha)) props.setProperty('enviado_' + fecha, 'respaldo');
  } finally { lock.releaseLock(); }
}

// ---------- Armar y enviar el informe de una fecha ----------
function enviarInforme(fecha) {
  const mes = fecha.slice(0, 7);
  const ventasMes = leerVentas(mes + '-01', siguienteMes(mes) + '-01').filter(v => !v.anulada);
  const hoy = ventasMes.filter(v => v.fecha === fecha);
  if (!hoy.length) { Logger.log('Sin ventas el ' + fecha + ': no se envía informe.'); return false; }
  const cierre = leerDoc('cierres/' + fecha);

  const carpeta = obtenerCarpeta();
  const libroMes = actualizarExcelMes(mes, ventasMes, carpeta);
  const libroDia = crearExcelDia(fecha, hoy, cierre, carpeta);

  const imgs = graficasMes(libroMes);
  const r = resumen(hoy);
  const html = correoHtml(fecha, r, cierre, ventasMes);
  MailApp.sendEmail({
    to: CONFIG.DESTINATARIOS.join(','),
    subject: 'Carpa Ántoca · Ventas ' + fecha + ' · ' + pesos(r.total),
    htmlBody: html,
    inlineImages: imgs,
    attachments: [aXlsx(libroDia, 'Carpa_Antoca_' + fecha + '.xlsx'), aXlsx(libroMes, 'Carpa_Antoca_ventas_' + mes + '.xlsx')],
    name: 'Carpa Ántoca',
  });
  return true;
}

// ---------- Firebase (Firestore REST con la sesión del dueño del proyecto) ----------
function api(path, opts) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.PROYECTO + '/databases/(default)/documents' + path;
  const res = UrlFetchApp.fetch(url, Object.assign({ headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': CONFIG.PROYECTO }, muteHttpExceptions: true, contentType: 'application/json' }, opts || {}));
  return { code: res.getResponseCode(), body: JSON.parse(res.getContentText() || '{}') };
}
function valor(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  return null;
}
function plano(doc) { const o = {}; Object.keys(doc.fields || {}).forEach(k => o[k] = valor(doc.fields[k])); return o; }
function leerVentas(desde, hasta) {
  const f = (op, s) => ({ fieldFilter: { field: { fieldPath: 'fecha' }, op, value: { stringValue: s } } });
  const q = { structuredQuery: { from: [{ collectionId: 'ventas' }], where: { compositeFilter: { op: 'AND', filters: [f('GREATER_THAN_OR_EQUAL', desde), f('LESS_THAN', hasta)] } } } };
  const r = api(':runQuery', { method: 'post', payload: JSON.stringify(q) });
  if (r.code !== 200) throw new Error('No se pudieron leer las ventas: ' + JSON.stringify(r.body));
  return r.body.filter(x => x.document).map(x => plano(x.document)).sort((a, b) => a.ts - b.ts);
}
function leerDoc(path) { const r = api('/' + path); return r.code === 200 ? plano(r.body) : null; }
function siguienteMes(mes) { const [y, m] = mes.split('-').map(Number); return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'); }

// ---------- Cálculos ----------
function resumen(vs) {
  const porPrecio = {}, porMedio = {};
  vs.forEach(v => { porPrecio[v.precio] = porPrecio[v.precio] || { prendas: 0, valor: 0 }; porPrecio[v.precio].prendas += v.cant; porPrecio[v.precio].valor += v.total; porMedio[v.medio] = (porMedio[v.medio] || 0) + v.total; });
  return { porPrecio, porMedio, total: vs.reduce((a, v) => a + v.total, 0), prendas: vs.reduce((a, v) => a + v.cant, 0), ventas: vs.length };
}
const hora = v => Utilities.formatDate(new Date(v.ts), CONFIG.TZ, 'HH:mm');
const diaSem = f => new Date(f + 'T12:00:00').getDay();
function filasVentas(vs) { return vs.map(v => [v.fecha, hora(v), DIAS[diaSem(v.fecha)], v.precio, v.cant, v.total, v.medio]); }

// ---------- Google Drive / Sheets ----------
function obtenerCarpeta() { const it = DriveApp.getFoldersByName(CONFIG.CARPETA); return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.CARPETA); }
function libroEn(carpeta, nombre) {
  const it = carpeta.getFilesByName(nombre);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  const ss = SpreadsheetApp.create(nombre); DriveApp.getFileById(ss.getId()).moveTo(carpeta); return ss;
}
function hoja(ss, nombre, encabezado, filas) {
  const sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  sh.clear(); sh.getCharts().forEach(c => sh.removeChart(c));
  const datos = [encabezado].concat(filas);
  sh.getRange(1, 1, datos.length, encabezado.length).setValues(datos);
  sh.getRange(1, 1, 1, encabezado.length).setFontWeight('bold').setBackground('#3A2E28').setFontColor('#FAF8F5');
  sh.setFrozenRows(1); sh.autoResizeColumns(1, encabezado.length);
  return sh;
}
function dinero(sh, col, n) { if (n > 0) sh.getRange(2, col, n, 1).setNumberFormat('$#,##0'); }

function actualizarExcelMes(mes, vs, carpeta) {
  const ss = libroEn(carpeta, 'Carpa Ántoca – Ventas ' + mes);
  // Hoja 1: todas las ventas del mes (se reescribe completa cada noche, así nunca queda duplicada)
  const shV = hoja(ss, 'Ventas', ['Fecha', 'Hora', 'Día', 'Precio', 'Cantidad', 'Total', 'Medio de pago'], filasVentas(vs));
  dinero(shV, 4, vs.length); dinero(shV, 6, vs.length);
  // Hoja 2: consolidado día a día con acumulado
  const fechas = [...new Set(vs.map(v => v.fecha))].sort(); let acum = 0;
  const diario = fechas.map(f => { const d = vs.filter(v => v.fecha === f), r = resumen(d); acum += r.total;
    return [f, DIAS[diaSem(f)], r.ventas, r.prendas].concat(CONFIG.MEDIOS.map(m => r.porMedio[m] || 0)).concat([r.total, acum]); });
  const shD = hoja(ss, 'Consolidado diario', ['Fecha', 'Día', 'Ventas', 'Prendas'].concat(CONFIG.MEDIOS, ['Total', 'Acumulado']), diario);
  for (let c = 5; c <= 6 + CONFIG.MEDIOS.length; c++) dinero(shD, c, diario.length);
  // Hoja 3: precios
  const rm = resumen(vs);
  const precios = Object.keys(rm.porPrecio).map(Number).sort((a, b) => rm.porPrecio[b].prendas - rm.porPrecio[a].prendas);
  const shP = hoja(ss, 'Por precio', ['Precio', 'Prendas', 'Valor'], precios.map(p => [pesos(p), rm.porPrecio[p].prendas, rm.porPrecio[p].valor]));
  dinero(shP, 3, precios.length);
  // Hoja 4: días de la semana (promedio por día abierto)
  const sem = SEMANA.map(w => { const fs = fechas.filter(f => diaSem(f) === w), tot = vs.filter(v => diaSem(v.fecha) === w);
    return [DIAS[w], fs.length, tot.length, fs.length ? Math.round(tot.reduce((a, v) => a + v.total, 0) / fs.length) : 0]; });
  const shS = hoja(ss, 'Por día de semana', ['Día', 'Días abiertos', 'Ventas', 'Venta promedio'], sem); dinero(shS, 4, 7);
  // Hoja 5: horas
  const horas = {}; vs.forEach(v => { const h = hora(v).slice(0, 2); horas[h] = (horas[h] || 0) + 1; });
  const shH = hoja(ss, 'Por hora', ['Hora', 'Ventas'], Object.keys(horas).sort().map(h => [h + ':00', horas[h]]));
  // Hoja 6: informe con gráficos nativos (se ven en Sheets y al abrir el .xlsx en Excel)
  const shI = ss.getSheetByName('Informe') || ss.insertSheet('Informe', 0);
  shI.clear(); shI.getCharts().forEach(c => shI.removeChart(c));
  shI.getRange('A1').setValue('Carpa Ántoca · ' + mes).setFontSize(18).setFontWeight('bold');
  shI.getRange('A2').setValue('Vendido: ' + pesos(rm.total) + ' · ' + rm.prendas + ' prendas · ' + fechas.length + ' días');
  const graf = (rango, tipo, titulo, fila, col) => shI.insertChart(shI.newChart().setChartType(tipo).addRange(rango)
    .setOption('title', titulo).setOption('legend', { position: 'none' }).setOption('colors', ['#3A2E28']).setOption('width', 620).setOption('height', 300)
    .setPosition(fila, col, 0, 0).build());
  if (diario.length) shI.insertChart(shI.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(shD.getRange(1, 1, diario.length + 1, 1)).addRange(shD.getRange(1, 5 + CONFIG.MEDIOS.length, diario.length + 1, 1))
    .setOption('title', 'Ventas por día').setOption('legend', { position: 'none' }).setOption('colors', ['#3A2E28'])
    .setOption('width', 620).setOption('height', 300).setPosition(4, 1, 0, 0).build());
  if (precios.length) graf(shP.getRange(1, 1, precios.length + 1, 2), Charts.ChartType.BAR, 'Precios que más se mueven (prendas)', 4, 9);
  const g3 = shI.newChart().setChartType(Charts.ChartType.COLUMN).addRange(shS.getRange('A1:A8')).addRange(shS.getRange('D1:D8'))
    .setOption('title', 'Días con más movimiento (venta promedio)').setOption('legend', { position: 'none' }).setOption('colors', ['#8C7B6B'])
    .setOption('width', 620).setOption('height', 300).setPosition(20, 1, 0, 0).build(); shI.insertChart(g3);
  if (Object.keys(horas).length) graf(shH.getRange(1, 1, Object.keys(horas).length + 1, 2), Charts.ChartType.COLUMN, 'Horas con más ventas', 20, 9);
  const s1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  SpreadsheetApp.flush();
  return ss;
}

function crearExcelDia(fecha, vs, cierre, carpeta) {
  const ss = libroEn(carpeta, 'Carpa Ántoca – Día ' + fecha);
  const r = resumen(vs), efec = r.porMedio['Efectivo'] || 0;
  const filas = [['Fecha', fecha], ['Total vendido', r.total], ['Prendas', r.prendas], ['Ventas', r.ventas]]
    .concat(CONFIG.MEDIOS.map(m => [m, r.porMedio[m] || 0]))
    .concat([['Base inicial', cierre ? cierre.base : CONFIG.BASE], ['Debe haber en efectivo', (cierre ? cierre.base : CONFIG.BASE) + efec],
             ['Efectivo contado', cierre ? cierre.contado : 'Sin cierre'], ['Diferencia', cierre ? cierre.diferencia : 'Sin cierre']]);
  hoja(ss, 'Resumen', ['Concepto', 'Valor'], filas).getRange(3, 2, filas.length - 1, 1).setNumberFormat('$#,##0');
  ss.getSheetByName('Resumen').getRange('B4:B5').setNumberFormat('0');
  const precios = Object.keys(r.porPrecio).map(Number).sort((a, b) => a - b);
  dinero(hoja(ss, 'Por precio', ['Precio', 'Prendas', 'Valor'], precios.map(p => [p, r.porPrecio[p].prendas, r.porPrecio[p].valor])), 3, precios.length);
  const shV = hoja(ss, 'Ventas', ['Fecha', 'Hora', 'Día', 'Precio', 'Cantidad', 'Total', 'Medio de pago'], filasVentas(vs));
  dinero(shV, 4, vs.length); dinero(shV, 6, vs.length);
  const s1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1'); if (s1) ss.deleteSheet(s1);
  SpreadsheetApp.flush();
  return ss;
}

function aXlsx(ss, nombre) {
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  return UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob().setName(nombre);
}
function graficasMes(ss) {
  const imgs = {};
  ss.getSheetByName('Informe').getCharts().forEach((c, i) => imgs['g' + i] = c.getAs('image/png'));
  return imgs;
}

// ---------- Correo ----------
function correoHtml(fecha, r, cierre, ventasMes) {
  const td = 'style="padding:6px 0;border-bottom:1px solid #E9E3DC"', tdn = 'style="padding:6px 0;border-bottom:1px solid #E9E3DC;text-align:right"';
  const precios = Object.keys(r.porPrecio).map(Number).sort((a, b) => a - b);
  const mes = resumen(ventasMes);
  let caja = '<p style="color:#B3261E">El día no se cerró en la app: no hay cuadre de caja.</p>';
  if (cierre) caja = '<p>Base ' + pesos(cierre.base) + ' + efectivo ' + pesos(cierre.efectivo) + ' = debe haber ' + pesos(cierre.base + cierre.efectivo) +
    '. Contado: ' + pesos(cierre.contado) + '. <b style="color:' + (cierre.diferencia === 0 ? '#2E7D4F' : '#B3261E') + '">' +
    (cierre.diferencia === 0 ? 'Cuadra' : (cierre.diferencia > 0 ? 'Sobran ' : 'Faltan ') + pesos(Math.abs(cierre.diferencia))) + '</b></p>';
  const imgs = [0, 1, 2, 3].map(i => '<img src="cid:g' + i + '" style="width:100%;max-width:620px;display:block;margin:10px 0" alt="">').join('');
  return '<div style="font-family:Arial,sans-serif;color:#1F1B18;max-width:640px">' +
    '<div style="background:#3A2E28;color:#FAF8F5;padding:18px;border-radius:12px"><div style="font-size:13px;color:#D9CFC5">Carpa Ántoca · ' + fecha + ' (' + DIAS[diaSem(fecha)] + ')</div>' +
    '<div style="font-size:34px;font-weight:bold">' + pesos(r.total) + '</div><div>' + r.prendas + ' prendas · ' + r.ventas + ' ventas</div></div>' +
    '<h3>Por precio</h3><table style="width:100%;border-collapse:collapse">' + precios.map(p => '<tr><td ' + td + '>' + pesos(p) + '</td><td ' + tdn + '>' + r.porPrecio[p].prendas + ' prendas</td><td ' + tdn + '>' + pesos(r.porPrecio[p].valor) + '</td></tr>').join('') + '</table>' +
    '<h3>Por medio de pago</h3><table style="width:100%;border-collapse:collapse">' + CONFIG.MEDIOS.map(m => '<tr><td ' + td + '>' + m + '</td><td ' + tdn + '>' + pesos(r.porMedio[m] || 0) + '</td></tr>').join('') + '</table>' +
    '<h3>Caja</h3>' + caja +
    '<h3>Mes a la fecha: ' + pesos(mes.total) + ' · ' + mes.prendas + ' prendas</h3>' + imgs +
    '<p style="font-size:12px;color:#6B6058">Adjuntos: Excel del día y Excel del mes con todas las ventas.</p></div>';
}

// Prueba manual: envía el informe de una fecha concreta.
function probarCon20261124() { enviarInforme('2026-11-24'); }
