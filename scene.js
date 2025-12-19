import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

// Ensure Home scene resets when returning via browser back/forward cache
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        window.location.reload();
    }
});

// === Basic Setup ===
const canvas = document.getElementById('webgl-canvas');
const loadingMessage = document.getElementById('loading-message');
const scene = new THREE.Scene();
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
};

// === Camera ===
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 100);
camera.position.z = 7.0;
scene.add(camera);

// === Renderer ===
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
});
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// === Physics Setup (CANNON.js) ===
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0); // Gravity pulling things down

// Invisible ground plane to collide with
const groundBody = new CANNON.Body({
    mass: 0, // mass 0 makes it static
    shape: new CANNON.Plane(),
});
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); // Rotate to be horizontal
groundBody.position.y = -5; // Floor position
world.addBody(groundBody);

// === Model Loading ===
const gltfLoader = new GLTFLoader();
const modelGroup = new THREE.Group(); // Group to hold points and lines
const modelColor = 0x111827; // text-gray-900

let lineGeometry = null;
let pointsGeometry = null;
let totalLineVertices = 0;
let totalPointsVertices = 0;

gltfLoader.load(
    'https://farzadona.com/humanoid3dmodel.glb',
    (gltf) => {
        let foundMesh = false;
        gltf.scene.traverse((child) => {
            if (child.isMesh && !foundMesh) {
                foundMesh = true;
                // 1. Create LineSegments (Wireframe)
                const wireframeGeometry = new THREE.WireframeGeometry(child.geometry);
                const lineMaterial = new THREE.LineBasicMaterial({ color: modelColor });
                const lineSegments = new THREE.LineSegments(wireframeGeometry, lineMaterial);
                lineSegments.material.depthTest = false; // Render on top
                lineSegments.material.opacity = 0.75;
                lineSegments.material.transparent = true;
                
                // 2. Create Points
                const pointsMaterial = new THREE.PointsMaterial({
                    color: modelColor,
                    size: 0.02, // [ADJUST] Adjusted point size for low-poly model
                    sizeAttenuation: true
                });
                const points = new THREE.Points(child.geometry, pointsMaterial);
                points.material.depthTest = false; // Render on top
                points.material.opacity = 0.5;
                points.material.transparent = true;

                // Store geometries for generative drawing and physics collapse
                lineGeometry = wireframeGeometry;
                pointsGeometry = child.geometry;
                totalLineVertices = lineGeometry.attributes.position.count;
                totalPointsVertices = pointsGeometry.attributes.position.count;

                // Set initial draw range to 0 so model is invisible
                lineGeometry.setDrawRange(0, 0);
                pointsGeometry.setDrawRange(0, 0);

                modelGroup.add(lineSegments);
                modelGroup.add(points);
            }
        });

        if (!foundMesh) {
            console.warn('GLTF model loaded but no mesh found to create wireframe/points.');
            loadingMessage.innerText = 'Model loaded but no renderable mesh found.';
        }
        
        modelGroup.scale.set(7, 7, 7); 
        modelGroup.position.y = -2.5;
        
        scene.add(modelGroup);
        loadingMessage.style.display = 'none';
    },
    undefined,
    (error) => {
        console.error('An error happened loading the humanoid model:', error);
        loadingMessage.innerText = 'Failed to load humanoid model. Check console for details.';
    }
);

// === Collapse & Physics Logic ===
let collapseTriggered = false;
const physicsObjects = []; // Stores { mesh, body } pairs

function triggerCollapse() {
    if (collapseTriggered) return;
    collapseTriggered = true;

    // 1. Hide original model and remove scroll listener
    modelGroup.visible = false;
    window.removeEventListener('scroll', handleScroll);

    // 2. Create physical bodies from the model's line segments
    if (!lineGeometry) return;

    const linePositions = lineGeometry.attributes.position;
    const lineMaterial = new THREE.LineBasicMaterial({ color: modelColor });

    // Use a smaller subset of lines for better performance
    const lineCount = linePositions.count;
    const step = Math.max(2, Math.floor(lineCount / 400)); // Create max ~200 line bodies

    for (let i = 0; i < lineCount; i += step * 2) {
        const start = new THREE.Vector3().fromBufferAttribute(linePositions, i);
        const end = new THREE.Vector3().fromBufferAttribute(linePositions, i + 1);

        start.applyMatrix4(modelGroup.matrixWorld);
        end.applyMatrix4(modelGroup.matrixWorld);

        const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const length = start.distanceTo(end);
        
        if (length < 0.01) continue; // Skip zero-length segments

        // Create Three.js mesh for the line
        const segmentGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-length / 2, 0, 0),
            new THREE.Vector3(length / 2, 0, 0)
        ]);
        const lineMesh = new THREE.Line(segmentGeom, lineMaterial);
        scene.add(lineMesh);

        // Create Cannon.js body (a thin box)
        const lineShape = new CANNON.Box(new CANNON.Vec3(length / 2, 0.01, 0.01));
        const body = new CANNON.Body({ mass: 0.1, position: new CANNON.Vec3(center.x, center.y, center.z) });
        
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
        body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

        body.addShape(lineShape);
        world.addBody(body);

        physicsObjects.push({ mesh: lineMesh, body: body });
    }

    // 3. Reset camera to a wider, static view
    targetCameraX = 0;
    targetCameraY = 2;
    targetCameraZ = 18; // Pull camera back
    targetCameraRotZ = 0;
    lookAtTarget.set(0, -2, 0); // Look at the pile
}

// Ensure all CTA buttons wait for the collapse animation before navigating away
const CTA_DELAY_MS = 2000;
['about-contact-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;

    const targetUrl = btn.dataset.targetUrl || btn.getAttribute('href');
    btn.addEventListener('click', (event) => {
        if (targetUrl) {
            event.preventDefault();
        }
        triggerCollapse();
        if (targetUrl) {
            setTimeout(() => { window.location.href = targetUrl; }, CTA_DELAY_MS);
        }
    });
});

// === Scroll & Lerp Logic ===
let scrollFraction = 0;
const lookAtTarget = new THREE.Vector3(0, -1.5, 0); // Target model's upper body

let targetCameraZ = 7.0, currentCameraZ = 7.0;
let targetCameraX = 0, currentCameraX = 0;
let targetCameraY = 0, currentCameraY = 0;
let targetCameraRotZ = 0, currentCameraRotZ = 0;

let targetDrawFraction = 0, currentDrawFraction = 0;

const white = { r: 255, g: 255, b: 255 };
const gray50 = { r: 249, g: 250, b: 251 }; // Tailwind's gray-50
let targetBg = { ...white }, currentBg = { ...white };

// Named function to be able to remove it later
const handleScroll = () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    scrollFraction = maxScroll > 0 ? window.scrollY / maxScroll : 0;
    
    targetCameraZ = 5.0 + Math.cos(scrollFraction * Math.PI * 2) * 4.5;
    targetCameraX = Math.sin(scrollFraction * Math.PI * 2) * 5.0;
    targetCameraY = Math.cos(scrollFraction * Math.PI * 4) * 2.0;
    targetCameraRotZ = Math.sin(scrollFraction * Math.PI * 2) * 0.8;
    
    targetBg.r = white.r + (gray50.r - white.r) * scrollFraction;
    targetBg.g = white.g + (gray50.g - white.g) * scrollFraction;
    targetBg.b = white.b + (gray50.b - white.b) * scrollFraction;

    targetDrawFraction = Math.min(1.0, scrollFraction * 4.0);
};
window.addEventListener('scroll', handleScroll);

// === Resize Handler ===
window.addEventListener('resize', () => {
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;
    
    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();
    
    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// === Animation Loop ===
const clock = new THREE.Clock();
const lerpFactor = 0.1;

const animate = () => {
    const deltaTime = clock.getDelta();

    // Lerp camera position & rotation (happens in both states)
    currentCameraX += (targetCameraX - currentCameraX) * lerpFactor;
    currentCameraY += (targetCameraY - currentCameraY) * lerpFactor;
    currentCameraZ += (targetCameraZ - currentCameraZ) * lerpFactor;
    currentCameraRotZ += (targetCameraRotZ - currentCameraRotZ) * lerpFactor;
    
    camera.position.set(currentCameraX, currentCameraY, currentCameraZ);
    camera.rotation.z = currentCameraRotZ;
    camera.lookAt(lookAtTarget);
    
    // Lerp background color
    currentBg.r += (targetBg.r - currentBg.r) * lerpFactor;
    currentBg.g += (targetBg.g - currentBg.g) * lerpFactor;
    currentBg.b += (targetBg.b - currentBg.b) * lerpFactor;
    document.body.style.backgroundColor = `rgb(${Math.floor(currentBg.r)}, ${Math.floor(currentBg.g)}, ${Math.floor(currentBg.b)})`;
    
    if (collapseTriggered) {
        // If collapsed, update physics
        world.step(1 / 60, deltaTime, 3);

        for (const obj of physicsObjects) {
            obj.mesh.position.copy(obj.body.position);
            obj.mesh.quaternion.copy(obj.body.quaternion);
        }
    } else {
        // If not collapsed, run normal animations
        modelGroup.rotation.y += 0.002;
        
        currentDrawFraction += (targetDrawFraction - currentDrawFraction) * lerpFactor;
        
        if (lineGeometry && pointsGeometry) {
            const lineDrawCount = Math.floor(currentDrawFraction * totalLineVertices);
            const pointsDrawCount = Math.floor(currentDrawFraction * totalPointsVertices);
            
            lineGeometry.setDrawRange(0, lineDrawCount);
            pointsGeometry.setDrawRange(0, pointsDrawCount);
        }
    }

    // Render the scene
    renderer.render(scene, camera);
    
    // Next frame
    requestAnimationFrame(animate);
};

animate();