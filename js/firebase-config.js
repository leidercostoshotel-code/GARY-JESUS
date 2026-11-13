// =====================================================================
//  CONFIGURACIÓN DE FIREBASE
//  1. Entra a https://console.firebase.google.com y crea un proyecto.
//  2. Compilación → Realtime Database → Crear base de datos.
//  3. Compilación → Authentication → Método de acceso → habilita "Anónimo".
//  4. Configuración del proyecto → Tus apps → Web (</>) → copia los datos aquí.
//  Mientras apiKey esté vacío, la hoja funciona en "modo local"
//  (se guarda en este navegador y se sincroniza entre pestañas).
// =====================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyCVCrkJfZ1ZDDwjgbWq62GBceYNaY4oeeM",
  authDomain: "actividadesswiss-7a9fc.firebaseapp.com",
  // Dirección de Realtime Database. Si en la consola aparece otra (por ejemplo
  // ...firebasedatabase.app), cópiala aquí.
  databaseURL: "https://actividadesswiss-7a9fc-default-rtdb.firebaseio.com",
  projectId: "actividadesswiss-7a9fc",
  storageBucket: "actividadesswiss-7a9fc.firebasestorage.app",
  messagingSenderId: "954859470050",
  appId: "1:954859470050:web:1520d7b21ed82c8a2e32bb"
};
