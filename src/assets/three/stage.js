/**
 * stage.js — where an asset model is shown: studio light, water or ground,
 * a camera fitted to the model, and a slow turn.
 *
 * Image-based light from a neutral room (RoomEnvironment) gives the metal
 * and glass something to reflect; a warm key light casts soft shadows, a
 * cool rim separates the model from the background. Filmic tone mapping.
 * Vessels float in water at their waterline; everything else stands on a
 * ground that only shows its shadow, so the model sits on the page.
 */
import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

function fadeTexture(inner, outer) {
    const c = document.createElement("canvas")
    c.width = c.height = 256
    const x = c.getContext("2d")
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128)
    g.addColorStop(0, inner); g.addColorStop(0.25, inner); g.addColorStop(1, outer)
    x.fillStyle = g
    x.fillRect(0, 0, 256, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
}

export function createStage(el, { interactive = true, autoRotate = true, preserve = false, pixelRatio } = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: preserve })
    renderer.setPixelRatio(pixelRatio || Math.min(2, window.devicePixelRatio || 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setClearColor(0x000000, 0)
    if (el) el.appendChild(renderer.domElement)
    renderer.domElement.style.display = "block"

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55

    const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 20000)
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    const rim = new THREE.DirectionalLight(0xbcd2ff, 1.1)
    const hemi = new THREE.HemisphereLight(0xd8e2f0, 0x2a2f36, 0.55)
    scene.add(key, key.target, rim, hemi)

    let controls = null
    if (interactive) {
        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.enablePan = false
        controls.autoRotate = autoRotate
        controls.autoRotateSpeed = 0.55        // a slow turn: one revolution in ~110 s
        controls.minPolarAngle = 0.15
        controls.maxPolarAngle = Math.PI / 2 - 0.04
    }

    let model = null, ground = null, raf = 0, size = { w: 1, h: 1 }, ticks = []
    const clock = new THREE.Clock()

    function resize(w, h) {
        size = { w: Math.max(1, w), h: Math.max(1, h) }
        renderer.setSize(size.w, size.h, false)
        renderer.domElement.style.width = `${size.w}px`
        renderer.domElement.style.height = `${size.h}px`
        camera.aspect = size.w / size.h
        camera.updateProjectionMatrix()
    }

    function clear() {
        if (model) { scene.remove(model); model = null }
        if (ground) { scene.remove(ground); ground.geometry.dispose(); ground = null }
        ticks = []
    }

    /** built: {group, setting: "water"|"land", waterline?} */
    function setModel(built, opts = {}) {
        const { azimuth = built.view?.azimuth ?? -0.62, elevation = built.view?.elevation ?? 0.36, fill = 1.0 } = opts
        clear()
        model = built.group
        model.traverse((o) => { if (o.userData?.tick) ticks.push(o.userData.tick) })
        if (model.userData?.tick) ticks.push(model.userData.tick)
        scene.add(model)
        const box = new THREE.Box3().setFromObject(model)
        const sph = box.getBoundingSphere(new THREE.Sphere())
        const R = sph.radius
        const water = built.setting === "water"
        const groundY = water ? (built.waterline ?? box.min.y + (box.max.y - box.min.y) * 0.18) : box.min.y
        // ground: water that fades out, or a shadow catcher on a faint disc
        if (water) {
            // water that fades to nothing by distance from the centre (in the
            // shader: an alpha texture left a hard bright rim at grazing angles)
            const gm = new THREE.MeshStandardMaterial({ color: 0x245a78, roughness: 0.48, metalness: 0.0, transparent: true, depthWrite: false })
            const inner = R * 0.9, outer = R * 2.4
            gm.onBeforeCompile = (sh) => {
                sh.uniforms.uInner = { value: inner }; sh.uniforms.uOuter = { value: outer }
                sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vLocal;")
                    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position.xy;")
                sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vLocal;\nuniform float uInner;\nuniform float uOuter;")
                    .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.a *= 0.94 * (1.0 - smoothstep(uInner, uOuter, length(vLocal)));")
            }
            gm.customProgramCacheKey = () => `water-${inner.toFixed(1)}-${outer.toFixed(1)}`
            ground = new THREE.Mesh(new THREE.CircleGeometry(outer, 128), gm)
        } else {
            const gm = new THREE.ShadowMaterial({ opacity: 0.32 })
            ground = new THREE.Mesh(new THREE.CircleGeometry(R * 1.6, 96), gm)
        }
        ground.rotation.x = -Math.PI / 2
        ground.position.set(sph.center.x, groundY, sph.center.z)
        ground.receiveShadow = true
        scene.add(ground)
        // lights scaled to the model
        key.position.set(sph.center.x + R * 1.4, sph.center.y + R * 2.2, sph.center.z + R * 1.1)
        key.target.position.copy(sph.center)
        const sc = key.shadow.camera
        sc.left = sc.bottom = -R * 1.3; sc.right = sc.top = R * 1.3; sc.near = R * 0.5; sc.far = R * 6
        sc.updateProjectionMatrix()
        rim.position.set(sph.center.x - R * 2, sph.center.y + R * 0.8, sph.center.z - R * 1.6)
        // camera: three-quarter view from above; move in until the model's
        // own corners fill the frame (a bounding sphere wastes the frame on
        // anything long, like a ship)
        const target = sph.center.clone(); target.y = groundY + (box.max.y - groundY) * 0.4
        const dir = new THREE.Vector3(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth))
        // points sampled from the model itself (a box's empty corners would
        // leave an aircraft small in the frame)
        const corners = []
        model.updateMatrixWorld(true)
        model.traverse((o) => {
            if (!o.isMesh || o.isInstancedMesh) return
            const pa = o.geometry.attributes.position
            const step = Math.max(1, Math.floor(pa.count / 60))
            for (let i = 0; i < pa.count; i += step) {
                const v = new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld)
                if (v.y >= groundY - 0.01) corners.push(v)
            }
        })
        if (!corners.length) for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, box.max.y, z))
        const place = (d) => { camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix() }
        const fits = (d) => {
            place(d)
            return corners.every((c) => { const p = c.clone().project(camera); return Math.abs(p.x) <= 0.86 * fill && Math.abs(p.y) <= 0.8 * fill && p.z < 1 })
        }
        let lo = R * 0.2, hi = R * 8
        for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid }
        const dist = hi
        camera.near = dist / 60; camera.far = dist * 12
        place(dist)
        if (controls) { controls.target.copy(target); controls.minDistance = dist * 0.35; controls.maxDistance = dist * 1.8; controls.update() }
    }

    function render() {
        const t = clock.getElapsedTime()
        for (const f of ticks) f(t)
        controls?.update()
        renderer.render(scene, camera)
    }
    function start() { const loop = () => { render(); raf = requestAnimationFrame(loop) }; loop() }
    function stop() { cancelAnimationFrame(raf) }
    function dispose() {
        stop(); clear(); controls?.dispose(); pmrem.dispose(); renderer.dispose()
        renderer.domElement.remove()
    }
    return { renderer, scene, camera, controls, resize, setModel, render, start, stop, dispose, get size() { return size } }
}
