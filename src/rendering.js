import * as THREE from 'three';
import {publicAsset} from './assets.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {Sky} from 'three/addons/objects/Sky.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';

const presets = {
  golden:{sun:0xffe5ba,intensity:3.2,sky:0xdce9f1,ground:0x696447,fog:0xc4bda4,exposure:1.05,environment:.85,sunDirection:[-150,105,170],density:.00034},
  clear:{sun:0xfff5e5,intensity:3.5,sky:0xd2e7ff,ground:0x6c7851,fog:0xc2d3d8,exposure:1.05,environment:.85,sunDirection:[-80,240,95],density:.00027},
  overcast:{sun:0xe9efff,intensity:1.0,sky:0xd1d9e0,ground:0x677466,fog:0xaebcbf,exposure:.98,environment:.9,sunDirection:[-100,280,90],density:.00048},
};

export async function createRendering(canvas, {quality = 'high', weather = 'golden'} = {}) {
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  // Geographic simulation coordinates use north=+Z and east=+X. Reflect north
  // into Three's -Z-forward rendering space so steering and the real circuit
  // retain their physical handedness. Keep the camera/lights in render space.
  const worldRoot = new THREE.Group();
  worldRoot.name = 'geographic-world';
  worldRoot.scale.z = -1;
  scene.add(worldRoot);
  const camera = new THREE.PerspectiveCamera(56,1,.08,4500);
  const hemisphere = new THREE.HemisphereLight(0xdce9f1,0x696447,1.25);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe5ba,3.2);
  sun.castShadow = true;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.camera.left = -85;
  sun.shadow.camera.right = 85;
  sun.shadow.camera.top = 85;
  sun.shadow.camera.bottom = -85;
  sun.shadow.normalBias = .055;
  sun.shadow.bias = -.0002;
  sun.shadow.radius = 2;
  scene.add(sun,sun.target);
  let hdr = null;
  try {
    hdr = await new RGBELoader().loadAsync(publicAsset('textures/sky.hdr'));
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    scene.background = hdr;
    scene.backgroundRotation.y = 1.75;
    scene.environmentRotation.y = 1.75;
    scene.backgroundIntensity = .8;
  } catch { /* The procedural sky is a functional fallback if an asset is unavailable. */ }
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.4;
  uniforms.rayleigh.value = 1.4;
  uniforms.mieCoefficient.value = .004;
  uniforms.mieDirectionalG.value = .85;
  sky.visible = !hdr;
  scene.add(sky);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1,1),.10,.35,1.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms:{tDiffuse:{value:null},amount:{value:.15},time:{value:0}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D tDiffuse;uniform float amount;uniform float time;varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){vec3 color=texture2D(tDiffuse,vUv).rgb;vec2 p=vUv-.5;float vignette=1.-dot(p,p)*amount;
    color*=vignette;float noise=(hash(gl_FragCoord.xy+fract(time)*100.)-.5)/420.;
    gl_FragColor=vec4(color+noise,1.);}`
  });
  composer.addPass(grade);
  const antialias=new ShaderPass(FXAAShader);composer.addPass(antialias);
  let currentQuality = quality;
  let currentWeather = weather;
  let needsRender = true;
  let adaptiveScale=1,adaptTime=0,adaptFrames=0,adaptWarmup=3;
  let sunDirection = new THREE.Vector3();
  function setWeather(value) {
    needsRender = true;
    currentWeather = value in presets ? value : 'golden';
    const p = presets[currentWeather];
    hemisphere.color.set(p.sky); hemisphere.groundColor.set(p.ground);
    hemisphere.intensity = currentWeather === 'overcast' ? 1.45 : .8;
    sun.color.set(p.sun);sun.intensity = p.intensity;
    sunDirection.fromArray(p.sunDirection);
    renderer.toneMappingExposure = p.exposure;
    scene.environmentIntensity = p.environment;
    scene.fog = new THREE.FogExp2(p.fog,p.density);
    uniforms.sunPosition.value.copy(sunDirection).normalize();
    uniforms.turbidity.value = currentWeather === 'overcast' ? 14 : 3.4;
    uniforms.rayleigh.value = currentWeather === 'clear' ? 2.2 : 1.4;
    if (hdr && currentWeather === 'golden') {scene.background=hdr;sky.visible=false;}
    else {scene.background=new THREE.Color(p.fog);sky.visible=true;}
    if (currentWeather === 'overcast') {sky.visible=false;}
  }
  function resize() {
    needsRender = true;
    const width=window.innerWidth,height=window.innerHeight;
    const maxRatio = currentQuality === 'ultra' ? 1.5 : currentQuality === 'high' ? 1.2 : .85*adaptiveScale;
    const ratio=Math.min(window.devicePixelRatio || 1,maxRatio);
    renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
    composer.setPixelRatio(ratio);composer.setSize(width,height);
    antialias.uniforms.resolution.value.set(1/(width*ratio),1/(height*ratio));
    camera.aspect=width/height;camera.updateProjectionMatrix();
  }
  function setQuality(value) {
    currentQuality=value;
    adaptiveScale=1;adaptTime=0;adaptFrames=0;adaptWarmup=3;
    const size=value==='ultra'?4096:value==='high'?2048:1024;
    sun.shadow.mapSize.set(size,size);
    if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
    bloom.enabled=value!=='performance';
    resize();
  }
  function adapt(dt){
    if(currentQuality!=='performance'||dt<=0||dt>.3)return;
    if(adaptWarmup>0){adaptWarmup-=dt;return;}
    adaptTime+=dt;adaptFrames++;
    if(adaptTime<2.5)return;
    const fps=adaptFrames/adaptTime;
    const next=fps<30?Math.max(.76,adaptiveScale-.06):fps>50?Math.min(1,adaptiveScale+.03):adaptiveScale;
    adaptTime=0;adaptFrames=0;
    if(next!==adaptiveScale){adaptiveScale=next;resize();}
  }
  function updateLighting(position) {
    // A camera-following shadow volume spends shadow pixels around the driver.
    const x=Math.round(position.x/5)*5,z=Math.round(position.z/5)*5;
    sun.target.position.set(x,0,-z);
    sun.position.set(x+sunDirection.x,sunDirection.y,-z-sunDirection.z);
  }
  function render(time=0){
    renderer.info.reset();grade.uniforms.time.value=time;
    // The native antialiased framebuffer avoids several HDR postprocessing
    // buffers and full-screen passes on integrated GPUs.
    if(currentQuality==='performance')renderer.render(scene,camera);
    else composer.render();
    needsRender = false;
  }
  setWeather(weather);setQuality(quality);
  window.addEventListener('resize',resize);
  return {renderer,scene,worldRoot,camera,composer,sun,setWeather,setQuality,resize,adapt,updateLighting,render,
    get quality(){return currentQuality},get weather(){return currentWeather},get needsRender(){return needsRender}};
}
