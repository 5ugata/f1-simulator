// Use Playwright's installed browser on any platform. Local hardware testing
// can choose a system browser and graphics backend without editing scripts.
export function browserOptions() {
  const args=['--no-sandbox','--disable-dev-shm-usage'];
  const graphics=process.env.APEX_GRAPHICS || 'default';
  if(graphics==='gl')args.push('--use-gl=angle','--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist');
  else if(graphics==='swiftshader')args.push('--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader');
  else if(graphics!=='default')throw new Error('APEX_GRAPHICS must be default, gl or swiftshader.');
  return {headless:true,args,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})};
}
