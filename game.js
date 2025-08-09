// Game variables
let scene, camera, renderer;
let targets = [];
let score = 0;
let timeLeft = 30;
let gameActive = false;
let raycaster, mouse;
let gameTimer = null;
let spawnMode = 'Free Space';
let wallConfig = null;
let mouseSensitivity = 1.0;
let isTimed = false;

// ------- Initialization -------
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

    // Event listeners (renderer)
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('click', onMouseClick);
    renderer.domElement.addEventListener('mousemove', onMouseMove);

    // Global listeners
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('keydown', onGlobalKeyDown);

    // Bind UI/menu logic
    bindUI();

    // Start animation loop
    animate();

    // Ensure HUD hidden while in menus on load
    setHUDVisible(false);
    // Ensure only main menu is visible on load (HTML already does this, but enforce)
    showOnlyMenu('mainMenu');
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

// ------- Target Spawning -------
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

// ------- Offscreen indicator helpers -------
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

// ------- Input handlers -------
function onMouseMove(event) {
    if (!gameActive) return;

    // Calculate mouse position for raycasting
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Camera rotation based on mouse movement and sensitivity
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    const base = 0.002;
    const factor = base * mouseSensitivity;
    
    camera.rotation.y -= movementX * factor;
    camera.rotation.x -= movementY * factor;
    
    // Limit vertical rotation and prevent roll
    camera.rotation.x = Math.max(-Math.PI/3, Math.min(Math.PI/3, camera.rotation.x));
    camera.rotation.z = 0;
}

function onMouseClick(event) {
    if (!gameActive) return;

    // Cast ray from camera (center crosshair)
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
        const scoreEl = document.getElementById('score');
        if (scoreEl) scoreEl.textContent = `Score: ${score}`;
        
        // Create new target
        setTimeout(createTarget, 500);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerLockChange() {
    const locked = document.pointerLockElement === renderer.domElement;
    // If we lose pointer lock during a game, return to main menu
    if (!locked && gameActive) {
        returnToMainMenu();
    }
}

function onGlobalKeyDown(e) {
    if (e.key === 'Escape') {
        // From anywhere, go to main menu
        if (gameActive) {
            returnToMainMenu();
        } else {
            // Ensure main menu is shown if not in game
            showOnlyMenu('mainMenu');
            setHUDVisible(false);
        }
    }
}

// ------- UI and Menu logic -------
function bindUI() {
    // Sensitivity: load, display, and wire
    const sensInput = document.getElementById('sensInput');
    const sensValue = document.getElementById('sensValue');

    if (sensInput && sensValue) {
        const saved = localStorage.getItem('mouseSensitivity');
        if (saved !== null) {
            mouseSensitivity = parseFloat(saved) || 1.0;
            sensInput.value = String(mouseSensitivity);
        } else {
            mouseSensitivity = parseFloat(sensInput.value) || 1.0;
        }
        sensValue.textContent = String(mouseSensitivity.toFixed(1));

        sensInput.addEventListener('input', () => {
            mouseSensitivity = parseFloat(sensInput.value) || 1.0;
            sensValue.textContent = String(mouseSensitivity.toFixed(1));
            try {
                localStorage.setItem('mouseSensitivity', String(mouseSensitivity));
            } catch {}
        });
    }

    // Navigation
    const gotoTimed = document.getElementById('gotoTimed');
    const gotoUntimed = document.getElementById('gotoUntimed');
    const backFromTimed = document.getElementById('backFromTimed');
    const backFromUntimed = document.getElementById('backFromUntimed');

    if (gotoTimed) gotoTimed.addEventListener('click', () => showOnlyMenu('timedMenu'));
    if (gotoUntimed) gotoUntimed.addEventListener('click', () => showOnlyMenu('untimedMenu'));
    if (backFromTimed) backFromTimed.addEventListener('click', () => showOnlyMenu('mainMenu'));
    if (backFromUntimed) backFromUntimed.addEventListener('click', () => showOnlyMenu('mainMenu'));

    // Start buttons
    const startTimed = document.getElementById('startTimed');
    const startUntimed = document.getElementById('startUntimed');

    if (startTimed) {
        startTimed.addEventListener('click', () => {
            const modeSel = document.getElementById('modeSelectTimed');
            const timeInput = document.getElementById('timeInput');
            const mode = modeSel ? modeSel.value : 'Free Space';
            const duration = timeInput ? Math.max(1, parseInt(timeInput.value) || 30) : 30;
            startGame({ mode, isTimed: true, duration });
        });
    }
    if (startUntimed) {
        startUntimed.addEventListener('click', () => {
            const modeSel = document.getElementById('modeSelectUntimed');
            const mode = modeSel ? modeSel.value : 'Free Space';
            startGame({ mode, isTimed: false });
        });
    }
}

function setHUDVisible(visible) {
    const ui = document.getElementById('ui');
    const crosshair = document.getElementById('crosshair');
    if (ui) ui.classList.toggle('hidden', !visible);
    if (crosshair) crosshair.classList.toggle('hidden', !visible);
}

function showOnlyMenu(idOrNull) {
    const menus = document.querySelectorAll('.menu');
    menus.forEach(m => m.classList.add('hidden'));
    if (idOrNull) {
        const el = document.getElementById(idOrNull);
        if (el) el.classList.remove('hidden');
    }
}

// ------- Game lifecycle -------
function startGame(config) {
    // config: { mode: 'Free Space' | 'Wall', isTimed: boolean, duration?: number }
    // Clean any previous session
    stopGameInternal();

    gameActive = true;
    score = 0;
    spawnMode = config.mode || 'Free Space';
    isTimed = !!config.isTimed;
    timeLeft = isTimed ? Math.max(1, config.duration || 30) : 0;

    // UI setup
    const scoreEl = document.getElementById('score');
    const timerEl = document.getElementById('timer');
    if (scoreEl) scoreEl.textContent = `Score: ${score}`;
    if (timerEl) {
        if (isTimed) {
            timerEl.classList.remove('hidden');
            timerEl.textContent = `Time: ${timeLeft}s`;
        } else {
            timerEl.classList.add('hidden');
        }
    }

    // Hide menus, show HUD
    showOnlyMenu(null);
    setHUDVisible(true);

    // Clear existing targets and indicators
    targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
    targets = [];

    // Setup wall if needed
    clearWall();
    if (spawnMode === 'Wall') {
        prepareWall();
    }

    // Spawn initial targets
    for (let i = 0; i < 5; i++) {
        createTarget();
    }

    // Request pointer lock for better mouse control
    // Must be called from user gesture (click on button) - which this is.
    renderer.domElement.requestPointerLock();

    // Start timer if timed
    if (isTimed) {
        gameTimer = setInterval(() => {
            timeLeft--;
            if (timerEl) timerEl.textContent = `Time: ${timeLeft}s`;
            if (timeLeft <= 0) {
                returnToMainMenu();
            }
        }, 1000);
    }
}

function stopGameInternal() {
    // Stop and cleanup without showing menus; used before starting a new session
    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }
    // Clear targets and indicators
    targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
    targets = [];
    // Remove wall if present
    clearWall();
    gameActive = false;
    // Exit pointer lock if active
    try { document.exitPointerLock(); } catch {}
}

function returnToMainMenu() {
    if (!gameActive && !gameTimer) {
        // Ensure menus visible even if not in a game
        showOnlyMenu('mainMenu');
        setHUDVisible(false);
        return;
    }
    // Clean up timer/targets/wall and state
    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }
    gameActive = false;

    targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
    targets = [];
    clearWall();

    // Hide HUD, show main menu
    setHUDVisible(false);
    showOnlyMenu('mainMenu');

    // Exit pointer lock
    try { document.exitPointerLock(); } catch {}
}

// ------- Main loop -------
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

// ------- Boot -------
init();
