// Game variables
let scene, camera, renderer;
let targets = [];
let score = 0;
let timeLeft = 30;
let gameActive = false;
let raycaster, mouse;
let gameTimer;
let spawnMode = 'Free Space';
let wallConfig = null;

// Initialize the game
function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x001122);
    scene.fog = new THREE.Fog(0x001122, 10, 100);

    // Create camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 5);
    camera.rotation.order = 'YXZ';
    camera.up.set(0, 1, 0);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('gameContainer').appendChild(renderer.domElement);

    // Setup raycaster for shooting
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    scene.add(directionalLight);

    // Create ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    scene.add(ground);

    // Create simple weapon model
    createWeapon();

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('click', onMouseClick);
    renderer.domElement.addEventListener('mousemove', onMouseMove);

    // Start animation loop
    animate();
}

function createWeapon() {
    // Simple weapon - just a basic rectangle for now
    const weaponGeometry = new THREE.BoxGeometry(0.1, 0.1, 1);
    const weaponMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const weapon = new THREE.Mesh(weaponGeometry, weaponMaterial);
    weapon.position.set(0.5, -0.5, -2);
    weapon.rotation.x = 0.2;
    camera.add(weapon);
    scene.add(camera);
}

function createTarget() {
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshLambertMaterial({ 
        color: new THREE.Color(Math.random(), Math.random(), Math.random()) 
    });
    const target = new THREE.Mesh(geometry, material);
    
    if (spawnMode === 'Wall' && wallConfig) {
        const u = (Math.random() - 0.5) * wallConfig.width;

        const minY = -0.4;
        const maxY = 3.0;
        // Choose v so target stays within visible vertical band
        let vMin = minY - wallConfig.center.y;
        let vMax = maxY - wallConfig.center.y;
        const halfH = wallConfig.height / 2;
        vMin = Math.max(vMin, -halfH);
        vMax = Math.min(vMax, halfH);
        if (vMax <= vMin) {
            vMin = -halfH;
            vMax = halfH;
        }
        const v = vMin + Math.random() * (vMax - vMin);

        const pos = wallConfig.center.clone()
            .add(wallConfig.right.clone().multiplyScalar(u))
            .add(wallConfig.up.clone().multiplyScalar(v));

        // Offset outward so the sphere sits on the wall surface (radius = 0.5)
        if (wallConfig.normal) {
            pos.add(wallConfig.normal.clone().multiplyScalar(0.5));
        }

        target.position.copy(pos);
    } else {
        // Random position in front of camera (free space)
        const angle = Math.random() * Math.PI * 2;
        const distance = 10 + Math.random() * 20;
        target.position.x = Math.cos(angle) * distance;
        const minY = -0.4; // keep above ground (ground at -1, target radius ~0.5)
        const maxY = 3.0;
        target.position.y = minY + Math.random() * (maxY - minY);
        target.position.z = Math.sin(angle) * distance - 10;
    }
    
    scene.add(target);
    targets.push(target);
    createIndicatorForTarget(target);
}

/* Wall mode helpers */
function prepareWall() {
    const worldUp = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.normalize();

    let right = new THREE.Vector3().crossVectors(forward, worldUp);
    if (right.lengthSq() < 1e-6) {
        // Fallback if looking straight up/down
        right = new THREE.Vector3(1, 0, 0);
    } else {
        right.normalize();
    }
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    const wallDistance = 20;
    const wallWidth = 30;
    const wallHeight = 8;

    const center = camera.position.clone().add(forward.clone().multiplyScalar(wallDistance));

    // Visual wall panel (lighter gray than floor)
    const wallGeom = new THREE.PlaneGeometry(wallWidth, wallHeight);
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x666666, side: THREE.DoubleSide });
    const wallMesh = new THREE.Mesh(wallGeom, wallMat);
    wallMesh.position.copy(center);
    // Make plane face the camera (plane front +Z should face toward camera => align +Z with -forward)
    wallMesh.lookAt(center.clone().sub(forward));
    scene.add(wallMesh);

    const normal = forward.clone().negate();

    wallConfig = {
        center,
        right,
        up,
        width: wallWidth,
        height: wallHeight,
        distance: wallDistance,
        mesh: wallMesh,
        normal
    };
}

function clearWall() {
    if (wallConfig && wallConfig.mesh) {
        scene.remove(wallConfig.mesh);
        wallConfig.mesh.geometry.dispose();
        wallConfig.mesh.material.dispose();
    }
    wallConfig = null;
}

// Offscreen indicator helpers
function createIndicatorForTarget(target) {
    const el = document.createElement('div');
    el.className = 'indicator';
    el.textContent = '➤';
    el.style.display = 'none';
    const container = document.getElementById('gameContainer');
    container.appendChild(el);
    target.userData.indicator = el;
}

function removeIndicatorForTarget(target) {
    const el = target.userData && target.userData.indicator;
    if (el && el.parentNode) {
        el.parentNode.removeChild(el);
    }
    if (target.userData) {
        delete target.userData.indicator;
    }
}

function updateIndicators() {
    if (!gameActive) {
        targets.forEach(target => {
            const el = target.userData && target.userData.indicator;
            if (el) el.style.display = 'none';
        });
        return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const halfW = width / 2;
    const halfH = height / 2;
    const margin = 16; // keep arrows right at the inner edge

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    targets.forEach(target => {
        const el = target.userData && target.userData.indicator;
        if (!el) return;

        // Determine if off-screen/behind
        const worldPos = target.position.clone();
        const camToTarget = worldPos.clone().sub(camera.position);
        const isBehind = camToTarget.dot(forward) < 0;

        const ndc = worldPos.clone().project(camera);
        const isOffscreen = isBehind || ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1;

        if (!isOffscreen) {
            el.style.display = 'none';
            return;
        }

        el.style.display = 'block';

        // Flip NDC if behind so arrow points correctly
        let nx = ndc.x;
        let ny = ndc.y;
        if (isBehind) {
            nx = -nx;
            ny = -ny;
        }

        // Convert to screen-centered coordinates
        const sx = nx * halfW;
        const sy = -ny * halfH;

        // Scale to the inner edge of the screen rectangle
        const eps = 1e-6;
        const kx = (halfW - margin) / (Math.abs(sx) + eps);
        const ky = (halfH - margin) / (Math.abs(sy) + eps);
        const k = Math.min(kx, ky);

        const ex = sx * k;
        const ey = sy * k;

        const px = ex + halfW;
        const py = ey + halfH;

        // Point arrow from center toward the target direction
        const angle = Math.atan2(ey, ex);

        el.style.left = `${px}px`;
        el.style.top = `${py}px`;
        el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    });
}

function onMouseMove(event) {
    if (!gameActive) return;

    // Calculate mouse position for raycasting
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Simple camera rotation based on mouse movement
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;
    
    camera.rotation.y -= movementX * 0.002;
    camera.rotation.x -= movementY * 0.002;
    
    // Limit vertical rotation
    camera.rotation.x = Math.max(-Math.PI/3, Math.min(Math.PI/3, camera.rotation.x));
    // Prevent unintended roll
    camera.rotation.z = 0;
}

function onMouseClick(event) {
    if (!gameActive) return;

    // Cast ray from camera
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    // Check for intersections with targets
    const intersects = raycaster.intersectObjects(targets);
    
    if (intersects.length > 0) {
        const hitTarget = intersects[0].object;
        
        // Remove target
        scene.remove(hitTarget);
        removeIndicatorForTarget(hitTarget);
        targets = targets.filter(t => t !== hitTarget);
        
        // Update score
        score++;
        document.getElementById('score').textContent = `Score: ${score}`;
        
        // Create new target
        setTimeout(createTarget, 500);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function startGame() {
    gameActive = true;
    score = 0;
    timeLeft = parseInt(document.getElementById('timeInput').value);
    
    document.getElementById('score').textContent = `Score: ${score}`;
    document.getElementById('timer').textContent = `Time: ${timeLeft}s`;
    document.getElementById('instructions').classList.add('hidden');
    
    // Clear existing targets
    targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
    targets = [];

    // Determine spawn mode and set up wall if needed
    const modeEl = document.getElementById('modeSelect');
    spawnMode = modeEl ? modeEl.value : 'Free Space';
    clearWall();
    if (spawnMode === 'Wall') {
        prepareWall();
    }
    
    // Create initial targets
    for (let i = 0; i < 5; i++) {
        createTarget();
    }
    
    // Request pointer lock for better mouse control
    renderer.domElement.requestPointerLock();
    
    // Start timer
    gameTimer = setInterval(() => {
        timeLeft--;
        document.getElementById('timer').textContent = `Time: ${timeLeft}s`;
        
        if (timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

function endGame() {
    gameActive = false;
    clearInterval(gameTimer);
    
    document.getElementById('instructions').innerHTML = `
        <h2>Game Over!</h2>
        <p>Final Score: ${score}</p>
        <button onclick="resetGame()">Play Again</button>
    `;
    document.getElementById('instructions').classList.remove('hidden');

    // Hide indicators while game inactive
    targets.forEach(target => {
        const el = target.userData && target.userData.indicator;
        if (el) el.style.display = 'none';
    });

    // Remove wall if present
    clearWall();
    
    // Exit pointer lock
    document.exitPointerLock();
}

function resetGame() {
    document.getElementById('instructions').innerHTML = `
        Click to start. Move mouse to look around. Click targets to score points.
    `;
}

function animate() {
    requestAnimationFrame(animate);
    
    // Rotate targets slowly
    targets.forEach(target => {
        target.rotation.x += 0.01;
        target.rotation.y += 0.01;
    });
    
    updateIndicators();
    renderer.render(scene, camera);
}

// Event listeners for UI
document.getElementById('startBtn').addEventListener('click', startGame);

// Initialize when page loads
init();
