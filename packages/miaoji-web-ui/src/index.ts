// @wuji/miaoji-web-ui · public API
// The standalone app (or any host platform) mounts the screens like this:
//   <MiaojiProviders userId={...} routeBase="/miaoji" trpcUrl="/miaoji/trpc" ...>
//     <MiaojiLibrary /> | <MiaojiDetail token={t} /> | <MiaojiClip token={t} />
//   </MiaojiProviders>
// and imports the theme once in the host globals.css: `@import "@wuji/miaoji-web-ui/theme.css"`.
export { MiaojiProviders } from './providers'
export { MiaojiLibrary } from './screens/library'
export { MiaojiDetail } from './screens/minute-detail'
export { MiaojiClip } from './screens/clip-view'
export { miaojiConfig, setMiaojiConfig, type MiaojiConfig } from './lib/config'
