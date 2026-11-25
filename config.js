// Configuración de la carpa. Cambiar aquí precios, medios de pago y base.
window.CARPA_CONFIG = {
  precios: [15000, 20000, 25000, 30000, 40000, 50000, 60000],            
  medios: ['Efectivo', 'Transferencia'],
  base: 200000,                                               
  contarClientas: false,                                       
  avisoCierre: 'https://script.google.com/macros/s/AKfycbzZ3lbuXo7KeR6W1MvQGwzj-coGH0m-Y6lSZgK3Pj_NTEq6yoxjfQIUcJB6uvcJ6FzzbQ/exec',
  firebase: {
    apiKey: 'AIzaSyAtxvHva2yc60LNXYnInDJb5rmPtDHQq0U',
    authDomain: 'carpa-antoca.firebaseapp.com',
    projectId: 'carpa-antoca',
    storageBucket: 'carpa-antoca.firebasestorage.app',
    messagingSenderId: '1043901931033',
    appId: '1:1043901931033:web:f804f6e7dd80ff48e89488'
  }
};
