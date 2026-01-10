import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite';
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    // your config here
    allowedHosts: [
      'demo.doctorassist.ai'
    ]
  }
})


// import { defineConfig } from 'vite' 
// import react from '@vitejs/plugin-react'
// import tailwindcss from '@tailwindcss/vite'

// export default defineConfig({
//   base: '/new/',

//   plugins: [react(), tailwindcss()],

//   server: {
//     allowedHosts: ["demo.doctorassist.ai"],
//     origin: "https://demo.doctorassist.ai",

//     hmr: {
//       host: "demo.doctorassist.ai",
//       protocol: "wss",
//       port: 443
//     }
//   }
// })


