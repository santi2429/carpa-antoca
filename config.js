// Configuración de la carpa. Cambiar aquí precios, medios de pago y base.
window.CARPA_CONFIG = {
  precios: [15000, 20000, 25000, 30000, 40000, 50000, 60000],            
  medios: ['Efectivo', 'Transferencia'],
  base: 200000,                                               
  contarClientas: false,                                       
  avisoCierre: '', // PENDIENTE: URL de la aplicación web de Apps Script
  firebase: null // PENDIENTE: pegar aquí el bloque firebaseConfig del proyecto
};
