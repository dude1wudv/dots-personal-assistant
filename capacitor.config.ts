import type { CapacitorConfig } from '@capacitor/cli'
const config: CapacitorConfig = {
  appId: 'com.microedulab.dots', appName: '绒点', webDir: 'dist',
  server: { androidScheme: 'https', cleartext: false },
  android: { allowMixedContent: false, backgroundColor: '#ffffff' },
  plugins: { LocalNotifications: { smallIcon: 'ic_stat_dot', iconColor: '#4562e8' } },
}
export default config
