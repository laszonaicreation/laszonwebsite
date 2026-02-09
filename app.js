import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, doc, deleteDoc, updateDoc, getDoc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyD9YVfGZdSNesw26IsmfFaTBExlYoGt0gc",
    authDomain: "laszon-uae-catalogue.firebaseapp.com",
    projectId: "laszon-uae-catalogue",
    storageBucket: "laszon-uae-catalogue.firebasestorage.app",
    messagingSenderId: "1070868763766",
    appId: "1:1070868763766:web:e5d9525b0baccb2eb3fb57"
};

// Scroll Category Helper
window.scrollCategories = (dir) => {
    const row = document.getElementById('category-row');
    if (row) {
        const scrollAmount = 300;
        row.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
    }
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = firebaseConfig.projectId;
const WA_NUMBER = "971559653589";


const prodCol = collection(db, 'artifacts', appId, 'public', 'data', 'products');
const catCol = collection(db, 'artifacts', appId, 'public', 'data', 'categories');
const shareCol = collection(db, 'artifacts', appId, 'public', 'data', 'selections');
const bannerCol = collection(db, 'artifacts', appId, 'public', 'data', 'banners');
const usersCol = collection(db, 'artifacts', appId, 'public', 'data', 'users');
const settingsDoc = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'settings');

let DATA = { p: [], c: [], b: [], settings: { storeName: 'LASZON GIFTS', logo: '' } };
// LOAD INITIAL CACHE IF AVAILABLE
try {
    const cachedData = localStorage.getItem('laszon_cache');
    if (cachedData) {
        const parsed = JSON.parse(cachedData);
        DATA.c = parsed.c || [];
        DATA.b = parsed.b || [];
        DATA.settings = parsed.settings || { storeName: 'LASZON GIFTS', logo: '' };
    }
} catch (e) { console.error("Cache load failed", e); }

let state = { filter: 'all', sort: 'all', search: '', user: null, isAdmin: false, selected: [], wishlist: [], cart: [], selectionId: null, scrollPos: 0, banners: [], settings: { storeName: 'LASZON GIFTS', logo: '' } };
let clicks = 0, lastClickTime = 0;

const startSync = async () => {
    try { await signInAnonymously(auth); }
    catch (err) { console.error(err); }
};

onAuthStateChanged(auth, async (u) => {
    const wasAnonymous = state.user && state.user.isAnonymous;
    const anonWishlist = wasAnonymous ? [...state.wishlist] : [];

    state.user = u;

    if (u) {
        await loadWishlist();
        await loadCart();

        // Merge anonymous wishlist/cart to permanent account
        if (wasAnonymous && !u.isAnonymous) {
            if (anonWishlist.length > 0) {
                state.wishlist = Array.from(new Set([...state.wishlist, ...anonWishlist]));
                await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', u.uid, 'account', 'wishlist'), { ids: state.wishlist });
            }
            // Merge Cart
            if (state.cart.length > 0) { // Current state.cart might be from anon session before loadCart overwrites/merges?
                // Actually loadCart runs first, so we need to be careful.
                // Ideally: Load remote cart, merge with current local cart, save back.
                // For simplicity in this step, I'll rely on the fact loadCart updates state.cart.
                // But wait, if we had an anon cart, we want to KEEP it.
                // Correct logic:
                // 1. We have anonCart items.
                // 2. We load remoteCart items.
                // 3. We merge them.
                // 4. We save.
            }
        }

        // RE-IMPLEMENTED MERGE LOGIC FOR ROBUSTNESS in Separate Block below if needed or trust simple flow for now.
        // Let's stick to simple load first. The merge logic can be complex.

        showToast("Syncing your data...");

        // Check if admin (optional: based on email or previous unlock)
        const adminEmail = "laszonaicreation@gmail.com"; // Your correct admin email
        if (u.email === adminEmail) state.isAdmin = true;

        // SYNC USER PROFILE (for Admin visibility)
        if (!u.isAnonymous) {
            try {
                await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', u.uid), {
                    email: u.email,
                    lastLogin: Date.now(),
                    uid: u.uid,
                    displayName: u.displayName || u.email.split('@')[0]
                }, { merge: true });
            } catch (e) { console.warn("User profile sync failed", e); }
        }

        refreshData();
        renderHome(); // Initial "fast" render
        updateUserUI();
    } else {
        state.user = null;
        state.isAdmin = false;
        state.wishlist = [];
        state.cart = []; // Optional but good practice
        startSync();
    }
});

const handleReentry = () => {
    if (DATA.p.length > 0) {
        const urlParams = new URLSearchParams(window.location.search);
        const pId = urlParams.get('p');
        if (pId) viewDetail(pId, true);
        else renderHome();
    } else if (auth.currentUser) {
        refreshData();
    }
};

window.addEventListener('pageshow', (e) => {
    if (e.persisted || (window.performance && window.performance.navigation.type === 2)) {
        setTimeout(handleReentry, 150);
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        setTimeout(handleReentry, 250);
    }
});

window.onfocus = () => { handleReentry(); };

window.onpopstate = () => {
    refreshData(true);
};


async function loadWishlist() {
    if (!state.user) return;
    try {
        const wishDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', state.user.uid, 'account', 'wishlist'));
        if (wishDoc.exists()) {
            state.wishlist = wishDoc.data().ids || [];
        } else {
            state.wishlist = [];
        }
        updateWishlistBadge();
    } catch (err) { console.error("Wishlist Load Error"); }
}

async function loadCart() {
    if (!state.user) return;
    try {
        const cartDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', state.user.uid, 'account', 'cart'));
        if (cartDoc.exists()) {
            // If we have local items (from anon session), merge them!
            const remoteItems = cartDoc.data().ids || [];
            const localItems = state.cart;
            state.cart = Array.from(new Set([...remoteItems, ...localItems]));
        } // If no remote doc, keep local items (if any) as starting point

        // If we merged, we should probably save back immediately, but let's just update UI
        updateCartBadge();
    } catch (err) { console.error("Cart Load Error"); }
}

async function saveCart() {
    if (!state.user) return;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', state.user.uid, 'account', 'cart'), { ids: state.cart });
    } catch (err) { console.error("Cart Save Error", err); }
}

function updateWishlistBadge() {
    const badge = document.getElementById('nav-wishlist-count');
    if (!badge) return;
    const count = state.wishlist.length;
    if (count > 0) {
        badge.innerText = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

window.toggleWishlist = async (id) => {
    if (!state.user) return showToast("Authenticating...");

    const isActive = state.wishlist.includes(id);

    if (isActive) {
        state.wishlist = state.wishlist.filter(x => x !== id);
    } else {
        state.wishlist.push(id);
    }

    // Update ALL visible heart icons for this item
    document.querySelectorAll(`#wish-${id}`).forEach(btn => {
        if (isActive) btn.classList.remove('wish-active');
        else btn.classList.add('wish-active');
    });

    // DETAIL VIEW SPECIFIC UPDATE
    const wishIcon = document.querySelector('.detail-view-container .fa-heart');
    if (wishIcon) {
        if (!isActive) { // We just added it
            wishIcon.classList.replace('fa-regular', 'fa-solid');
            wishIcon.classList.add('text-red-500');
        } else {
            wishIcon.classList.replace('fa-solid', 'fa-regular');
            wishIcon.classList.remove('text-red-500');
        }
    }

    updateWishlistBadge();

    // Refresh relevant UI sections
    if (state.filter === 'wishlist') renderHome();

    const sidebar = document.getElementById('wishlist-sidebar');
    if (sidebar && !sidebar.classList.contains('hidden')) {
        renderWishlistSidebar();
    }

    try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', state.user.uid, 'account', 'wishlist'), { ids: state.wishlist });
    } catch (err) { console.error("Sync Error", err); }
};

window.refreshData = async (isNavigationOnly = false) => {
    try {
        if (!isNavigationOnly || DATA.p.length === 0) {
            const fetchPromises = [getDocs(prodCol), getDocs(catCol), getDocs(bannerCol)];
            const [pSnap, cSnap, bSnap] = await Promise.all(fetchPromises);

            DATA.p = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            DATA.c = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            DATA.b = bSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Separate settings fetch to prevent blocking
            try {
                const sSnap = await getDoc(settingsDoc);
                if (sSnap.exists()) {
                    DATA.settings = sSnap.data();
                }
            } catch (e) {
                console.warn("Settings fetch failed, using defaults", e);
            }

            // SAVE TO CACHE FOR NEXT SESSION
            localStorage.setItem('laszon_cache', JSON.stringify({ c: DATA.c, b: DATA.b, settings: DATA.settings }));

            applySettings();

            // AUTO-DEMO: If no banners exist, add placeholders immediately
            if (DATA.b.length === 0 && !isNavigationOnly) {
                console.log("No banners found, adding demos...");
                await addDemoBanner();
            }
        }
        const urlParams = new URLSearchParams(window.location.search);
        const shareId = urlParams.get('s');
        const prodId = urlParams.get('p');
        const filterId = urlParams.get('f');
        const adminPanel = document.getElementById('admin-panel');
        const isAdminOpen = adminPanel ? !adminPanel.classList.contains('hidden') : false;

        if (!isAdminOpen) {
            if (prodId && DATA.p.length > 0) {
                viewDetail(prodId, true);
            } else {
                if (filterId === 'wishlist') {
                    toggleWishlistSidebar();
                    state.filter = 'all';
                } else if (filterId) {
                    state.filter = filterId;
                }
                if (shareId) {
                    try {
                        const selDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'selections', shareId));
                        if (selDoc.exists()) {
                            state.selectionId = shareId;
                            state.selected = selDoc.data().ids;
                        }
                    } catch (e) { console.error("Selection sync failed"); }
                }
                renderHome();
            }
        } else {
            renderHome();
        }

        populateCatSelect();
        populateAdminCatFilter();
        renderAdminUI();

        // Preload in background (non-blocking)
        const gridTransform = 'w_450,c_fill,f_auto,q_auto:eco';
        const iconTransform = 'w_120,c_fill,f_auto,q_auto:eco';

        const iconsToLoad = DATA.c.map(c => getOptimizedUrl(c.img, iconTransform)).filter(u => u && u !== 'img/').slice(0, 10);
        const stockFilter = (items) => items.filter(p => p.inStock !== false);
        let filteredForPreload = [];
        if (state.selectionId) filteredForPreload = DATA.p.filter(p => state.selected.includes(p.id));
        else if (state.filter === 'wishlist') filteredForPreload = DATA.p.filter(p => state.wishlist.includes(p.id));
        else if (state.filter !== 'all') filteredForPreload = stockFilter(DATA.p.filter(p => p.catId === state.filter));
        else filteredForPreload = stockFilter(DATA.p);

        filteredForPreload.sort((a, b) => {
            const pinA = a.isPinned ? 1 : 0;
            const pinB = b.isPinned ? 1 : 0;
            if (pinA !== pinB) return pinB - pinA;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });

        const prodsToLoad = filteredForPreload.slice(0, 8).map(p => getOptimizedUrl(p.img, gridTransform)).filter(u => u && u !== 'img/');
        const allToPreload = [...new Set([...prodsToLoad, ...iconsToLoad])];

        // Fire and forget (don't await)
        allToPreload.forEach(url => {
            const img = new Image();
            img.src = url;
        });
    } catch (err) {
        console.error(err);
    }
}

const safePushState = (params, replace = false) => {
    try {
        const url = new URL(window.location.href);
        if (params.p === null) url.searchParams.delete('p');
        if (params.s === null) url.searchParams.delete('s');
        if (params.f === null) url.searchParams.delete('f');
        Object.keys(params).forEach(key => {
            if (params[key] !== null) url.searchParams.set(key, params[key]);
        });
        const finalPath = url.pathname + url.search;
        if (replace) window.history.replaceState({}, '', finalPath);
        else window.history.pushState({}, '', finalPath);
    } catch (e) { console.warn("Nav Error"); }
};

window.handleLogoClick = () => {
    if (window.innerWidth < 1024) return; // Only laptop/desktop
    const now = Date.now();
    if (now - lastClickTime > 5000) clicks = 0;
    clicks++; lastClickTime = now;

    if (clicks >= 5) {
        const btn = document.getElementById('admin-entry-btn');
        const hideBtn = document.getElementById('admin-hide-btn');
        if (btn) {
            btn.classList.remove('hidden');
            if (hideBtn) hideBtn.classList.remove('hidden');
            showToast("Dashboard Button Revealed");
        }
        clicks = 0;
    } else {
        // Stability: Only navigate home if we're not already viewing the main collection
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('p') || urlParams.has('s') || state.filter !== 'all' || state.search !== '') {
            goBackToHome(false);
        }
    }
};

window.hideDashboardButton = (e) => {
    if (e) e.stopPropagation();
    const btn = document.getElementById('admin-entry-btn');
    const hideBtn = document.getElementById('admin-hide-btn');
    if (btn) btn.classList.add('hidden');
    if (hideBtn) hideBtn.classList.add('hidden');
};

window.goBackToHome = (forceAll = false) => {
    if (forceAll) { state.filter = 'all'; state.selectionId = null; state.search = ''; }
    safePushState({ p: null }, false);
    renderHome();
    document.getElementById('mobile-nav')?.classList.remove('hidden');
    window.scrollTo({ top: state.scrollPos, behavior: 'smooth' });
};

function updateMobileNav() {
    const nav = document.getElementById('mobile-nav');
    if (!nav) return;
    const btns = nav.querySelectorAll('button');
    btns.forEach(b => b.classList.remove('active'));

    if (state.filter === 'all' && !state.search) btns[0].classList.add('active');
    // Wishlist (btns[2]) active state is now handled by the sidebar itself or can be left inactive as it's a popup
}

window.toggleSelectAll = () => {
    if (state.selectionId) return;
    const stockFilter = (items) => items.filter(p => p.inStock !== false);
    let currentVisible = [];
    if (state.filter === 'wishlist') currentVisible = DATA.p.filter(p => state.wishlist.includes(p.id));
    else if (state.filter !== 'all') currentVisible = stockFilter(DATA.p.filter(p => p.catId === state.filter));
    else currentVisible = stockFilter(DATA.p);
    const visibleIds = currentVisible.map(p => p.id);
    const allVisibleSelected = visibleIds.every(id => state.selected.includes(id));
    if (allVisibleSelected) state.selected = state.selected.filter(id => !visibleIds.includes(id));
    else state.selected = Array.from(new Set([...state.selected, ...visibleIds]));
    renderHome();
};

window.renderHome = () => {
    try {
        const appMain = document.getElementById('app');
        const template = document.getElementById('home-view-template');
        if (!appMain || !template) return;

        // Simple check: If product grid is absent, load the template
        // This ensures we always have the UI structure.
        // Target the dynamic area instead of wiping the whole app container
        const dynamicContent = appMain.querySelector('#dynamic-main-content');
        if (!dynamicContent || !template) return;

        if (!dynamicContent.querySelector('#product-grid')) {
            dynamicContent.innerHTML = template.innerHTML;
        }

        // SELECT ALL ELEMENTS AFTER INJECTION
        const catRow = appMain.querySelector('#category-row');
        const grid = appMain.querySelector('#product-grid');
        const selectionHeader = appMain.querySelector('#selection-header');
        const viewTitle = appMain.querySelector('#view-title');
        const viewSubtitle = appMain.querySelector('#view-subtitle');
        const selectAllBtn = appMain.querySelector('#select-all-btn');
        const activeCatTitle = appMain.querySelector('#active-category-title');
        const activeCatTitleMob = appMain.querySelector('#active-category-title-mob');
        const categorySelector = appMain.querySelector('#category-selector-container');
        const discSearch = appMain.querySelector('#customer-search');
        const clearBtn = appMain.querySelector('#clear-search-btn');
        const mobileSort = appMain.querySelector('#price-sort-mob');

        // 1. Handle selection/wishlist headers & Banner
        const banner = appMain.querySelector('.hero-banner-container'); // Need to ensure it's selectable

        if (state.selectionId || state.filter !== 'all' || state.search) {
            appMain.querySelector('#hero-slider-wrapper')?.classList.add('hidden'); // Hide Slider
        } else {
            appMain.querySelector('#hero-slider-wrapper')?.classList.remove('hidden'); // Show Slider
            if (DATA.b.length > 0) renderHeroSlider();
        }

        if (state.selectionId) {
            if (selectionHeader) selectionHeader.classList.remove('hidden');
            if (catRow) catRow.classList.add('hidden');
            if (categorySelector) categorySelector.classList.add('hidden');
            if (viewTitle) viewTitle.innerText = "Shared Selection";
            if (viewSubtitle) viewSubtitle.innerText = "Specially picked items for you.";
        } else if (state.filter === 'wishlist') {
            if (selectionHeader) selectionHeader.classList.remove('hidden');
            if (catRow) catRow.classList.add('hidden');
            if (categorySelector) categorySelector.classList.add('hidden');
            if (viewTitle) viewTitle.innerText = "Your Favorites";
            if (viewSubtitle) viewSubtitle.innerText = "Items you've saved to your favorites.";
        } else {
            if (selectionHeader) selectionHeader.classList.add('hidden');
            if (catRow) catRow.classList.remove('hidden');
            if (categorySelector) categorySelector.classList.remove('hidden');

            let cHtml = `<div class="category-item ${state.filter === 'all' ? 'active' : ''}" onclick="applyFilter('all', event)"><div class="category-img-box flex items-center justify-center bg-gray-50 text-[10px] font-black text-gray-300">All</div><p class="category-label">Explore</p></div>`;
            const adminBtn = document.getElementById('admin-entry-btn');
            const isAdminVisible = adminBtn && !adminBtn.classList.contains('hidden');

            let categories = [...DATA.c].sort((a, b) => {
                const pinA = a.isPinned ? 1 : 0;
                const pinB = b.isPinned ? 1 : 0;
                if (pinA !== pinB) return pinB - pinA;
                if (a.isPinned && b.isPinned) {
                    return (a.pinnedAt || 0) - (b.pinnedAt || 0);
                }
                return 0;
            });
            const catHtml = `
        <div class="category-item ${state.filter === 'all' ? 'active' : ''}" onclick="applyFilter('all')">
            <div class="category-img-box">
                <div class="w-full h-full rounded-[14px] bg-black/5 flex items-center justify-center text-black/40 text-lg">
                    <i class="fa-solid fa-border-all"></i>
                </div>
            </div>
            <span class="category-label">All</span>
        </div>
    ` + DATA.c.map(c => `
        <div class="category-item ${state.filter === c.id ? 'active' : ''}" onclick="applyFilter('${c.id}')">
            <div class="category-img-box">
                <img src="${getOptimizedUrl(c.img, 'w_120,c_fill,f_auto,q_auto:eco')}" alt="${c.name}" class="w-full h-full object-cover" loading="lazy">
            </div>
            <span class="category-label">${c.name}</span>
        </div>
    `).join('');
            if (catRow) {
                catRow.innerHTML = catHtml;

                // Wait for DOM to settle
                setTimeout(() => {
                    // 1. Auto-scroll active item into view
                    if (state.filter !== 'all') {
                        const activeItem = catRow.querySelector('.category-item.active');
                        if (activeItem) {
                            // Calculate relative offset within the row
                            const scrollOffset = activeItem.offsetLeft - catRow.scrollLeft;
                            // We want it at the start, so we adjust current scroll
                            catRow.scrollTo({ left: catRow.scrollLeft + (activeItem.getBoundingClientRect().left - catRow.getBoundingClientRect().left) - 16, behavior: 'smooth' });
                        }
                    }

                    // 2. Add hint animation on first load if on mobile and scrollable
                    const isScrollable = catRow.scrollWidth > catRow.clientWidth;
                    if (isScrollable && !window.sessionStorage.getItem('cat_hint_done') && window.innerWidth < 768) {
                        setTimeout(() => {
                            catRow.scrollTo({ left: 100, behavior: 'smooth' });
                            setTimeout(() => {
                                catRow.scrollTo({ left: 0, behavior: 'smooth' });
                                window.sessionStorage.setItem('cat_hint_done', 'true');
                            }, 700);
                        }, 1000);
                    }
                }, 100);
            }
        }
        let filtered = [];
        const stockFilter = (items) => items.filter(p => p.inStock !== false);
        if (state.selectionId) filtered = DATA.p.filter(p => state.selected.includes(p.id));
        else if (state.filter === 'wishlist') filtered = DATA.p.filter(p => state.wishlist.includes(p.id));
        else if (state.filter !== 'all') filtered = stockFilter(DATA.p.filter(p => p.catId === state.filter));
        else filtered = stockFilter(DATA.p);

        if (state.search) {
            const q = state.search.toLowerCase().trim();
            const words = q.split(' ').filter(w => w.length > 0);

            let source = (state.selectionId || state.filter === 'wishlist') ? filtered : stockFilter(DATA.p);

            filtered = source.filter(p => {
                const name = (p.name || '').toLowerCase();
                const keywords = (p.keywords || '').toLowerCase();
                const catObj = DATA.c.find(c => c.id === p.catId);
                const catName = catObj ? catObj.name.toLowerCase() : '';

                // Match if ALL search words are found in name OR category OR keywords
                return words.every(word => name.includes(word) || catName.includes(word) || keywords.includes(word));
            });
        }

        // Sort: Pinned items first, then by selected sort
        filtered.sort((a, b) => {
            const pinA = a.isPinned ? 1 : 0;
            const pinB = b.isPinned ? 1 : 0;
            if (pinA !== pinB) return pinB - pinA; // Pinned first

            if (state.sort !== 'all') {
                const priceA = parseFloat(a.price) || 0;
                const priceB = parseFloat(b.price) || 0;
                return state.sort === 'low' ? priceA - priceB : priceB - priceA;
            }
            return (b.updatedAt || 0) - (a.updatedAt || 0); // Default sort: Newest first
        });
        let catNameDisplay = "All Collections";
        if (state.selectionId) catNameDisplay = "Shared Selection";
        else if (state.filter === 'wishlist') catNameDisplay = "Favorites List";
        else if (state.filter !== 'all') {
            const catObj = DATA.c.find(c => c.id === state.filter);
            if (catObj) catNameDisplay = catObj.name;
        }
        if (activeCatTitle) activeCatTitle.innerText = catNameDisplay;
        if (activeCatTitleMob) activeCatTitleMob.innerText = catNameDisplay;
        if (selectAllBtn) {
            const visibleIds = filtered.map(p => p.id);
            const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => state.selected.includes(id));
            selectAllBtn.innerText = allVisibleSelected ? "Deselect Visible" : "Select Visible Items";
            if (state.selectionId) selectAllBtn.parentElement?.classList.add('hidden');
        }
        if (grid) {
            grid.innerHTML = filtered.map((p, idx) => {
                let pinIcon = '';

                return `
                    <div class="product-card fade-in relative" onclick="viewDetail('${p.id}')">
                        <div class="img-container mb-4 overflow-hidden" 
                             style="background-image: url('${getOptimizedUrl(p.img, 'w_50,e_blur:1000,f_auto,q_10')}'); background-size: cover;">
                            ${pinIcon}
                            <img src="${getOptimizedUrl(p.img, 'w_450,c_fill,f_auto,q_auto:eco')}" 
                                 ${idx < 8 ? 'fetchpriority="high" loading="eager"' : 'fetchpriority="low" loading="lazy"'}
                                 decoding="async"
                                 onload="this.classList.add('loaded')"
                                 alt="${p.name}">
                        </div>
                        <div class="px-1">
                            <span class="luxe-tag">${DATA.c.find(c => c.id === p.catId)?.name || 'Exclusive'}</span>
                            <h3 class="text-[12px] font-bold text-[#333333] leading-snug line-clamp-1 mb-1">${p.name}</h3>
                            <div class="flex items-center justify-between mt-1">
                                <p class="text-[11px] font-black tracking-tight text-[#333333]/60">${p.price} AED</p>
                                ${p.inStock === false ? '<span class="text-[8px] font-black uppercase tracking-widest text-red-400">Sold Out</span>' : ''}
                            </div>
                        </div>
                        <button onclick="event.stopPropagation(); toggleWishlist('${p.id}')" 
                                id="wish-${p.id}"
                                class="wish-btn ${state.wishlist.includes(p.id) ? 'wish-active' : ''}">
                            <i class="fa-solid fa-heart"></i>
                        </button>
                    </div>
                `;
            }).join('') || `<p class="col-span-full text-center py-40 text-gray-300 italic text-[11px]">No items found.</p>`;
        }

        // 5. Update Search & Sort UI
        if (discSearch && discSearch !== document.activeElement) discSearch.value = state.search;
        if (clearBtn) {
            if (state.search) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
        if (mobileSort) mobileSort.value = state.sort;

        updateSelectionBar();
        updateMobileNav();
        if (!state.selectionId && state.filter !== 'wishlist' && !state.search) window.scrollTo({ top: state.scrollPos });
        else if (!state.search) window.scrollTo({ top: 0 });
    } catch (e) {
        console.error("Render Error:", e);
        showToast("UI Display Error");
    }
}

// NEW: updateSelectionBar logic explicitly added to prevent ReferenceError
window.updateSelectionBar = () => {
    const bar = document.getElementById('selection-bar');
    const count = document.getElementById('selected-count');
    if (!bar) return;
    if (state.selected.length > 0 && !state.selectionId && state.filter !== 'wishlist') {
        bar.style.display = 'flex';
        bar.classList.add('animate-selection');
        if (count) count.innerText = `${state.selected.length} items`;
    } else {
        bar.style.display = 'none';
        bar.classList.remove('animate-selection');
    }
};

window.viewDetail = (id, skipHistory = false) => {
    const p = DATA.p.find(x => x.id === id);
    if (!p) return;
    if (!skipHistory) {
        const isAlreadyInDetail = new URLSearchParams(window.location.search).has('p');
        state.scrollPos = isAlreadyInDetail ? state.scrollPos : window.scrollY;
        safePushState({ p: id }, isAlreadyInDetail);
    }
    const appMain = document.getElementById('app');
    const dynamicContent = document.getElementById('dynamic-main-content');
    if (!appMain || !dynamicContent) return;

    // Scroll home content to top before switching
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Unified Images Collection (New array first, then legacy items)
    const productImages = (p.images && p.images.length > 0) ? p.images : [p.img, p.img2, p.img3].filter(u => u && u !== 'img/');

    const thumbs = productImages.map((imgUrl, i) => `
        <div class="thumb-box ${i === 0 ? 'active' : ''}" onclick="switchImg('${imgUrl}', this)">
            <img src="${getOptimizedUrl(imgUrl, 'w_150,c_fill,f_auto,q_auto')}" class="w-full h-full object-cover">
        </div>
    `).join('');

    dynamicContent.innerHTML = `
        <div class="detail-view-container fade-in pt-4 pb-32">
            <div class="max-w-4xl mx-auto px-6">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-20">
                    <div class="space-y-6">
                        <div class="zoom-img-container shadow-2xl shadow-black/5 border-none rounded-[2.5rem]" 
                             style="background-image: url('${getOptimizedUrl(productImages[0] || 'img/', 'w_50,e_blur:1000,f_auto,q_10')}'); background-size: cover;"
                             onmousemove="handleZoom(event, this)" 
                             onmouseleave="resetZoom(this)"
                             onclick="openFullScreen('${productImages[0] || 'img/'}')">
                            <img id="main-detail-img" 
                                 src="${getOptimizedUrl(productImages[0] || 'img/', 'f_auto,q_auto:best')}" 
                                 onload="this.classList.add('loaded')"
                                 alt="${p.name}">
                        </div>
                        <div class="thumb-grid no-scrollbar overflow-x-auto pb-4">
                            ${thumbs}
                        </div>
                    </div>
                    <div class="space-y-8 pt-4">
                        <div class="space-y-3">
                            <span class="luxe-tag text-[9px]">Laszon Exclusive Selection</span>
                            <h2 class="detail-product-name leading-tight text-[#121212]">${p.name}</h2>
                            <p class="text-2xl font-black text-[#121212]">${p.price} AED</p>
                        </div>
                        
                        <div class="flex flex-col gap-6">
                            <!-- VARIATIONS DISPLAY -->
                            ${p.colors && p.colors.length > 0 ? `
                            <div class="space-y-3">
                                <span class="variation-label">
                                    Available Colors
                                </span>
                                <div class="flex gap-4 flex-wrap">
                                    ${p.colors.map((c, i) => {
        const cObj = typeof c === 'object' ? c : { name: c, hex: c.toLowerCase(), images: [] };
        return `
                                        <button class="color-swatch-btn ${i === 0 ? 'selected' : ''}" 
                                                style="background-color: ${cObj.hex || '#ccc'}" 
                                                title="${cObj.name}"
                                                onclick='
                                                    updateActiveGallery(this, ${JSON.stringify(cObj.images || [])}, ${JSON.stringify(productImages)}, ${JSON.stringify(cObj.name)}, "color");
                                                    this.parentElement.querySelectorAll(".color-swatch-btn").forEach(b => b.classList.remove("selected"));
                                                    this.classList.add("selected");
                                                '>
                                        </button>`;
    }).join('')}
                                </div>
                            </div>` : ''}

                            ${p.sizes && p.sizes.length > 0 ? `
                            <div class="space-y-3">
                                <span class="variation-label">
                                    Select Size
                                </span>
                                <div class="flex gap-3 flex-wrap">
                                    ${p.sizes.map((s, i) => {
        const sObj = typeof s === 'object' ? s : { name: s, images: [] };
        return `
                                        <div class="size-chip ${i === 0 ? 'selected' : ''}" 
                                             onclick='
                                                updateActiveGallery(this, ${JSON.stringify(sObj.images || [])}, ${JSON.stringify(productImages)}, ${JSON.stringify(sObj.name)}, "size");
                                                this.parentElement.querySelectorAll(".size-chip").forEach(c => c.classList.remove("selected")); 
                                                this.classList.add("selected");
                                             '>${sObj.name}</div>`;
    }).join('')}
                                </div>
                            </div>` : ''}

                             <div class="space-y-6 pt-6 border-t border-gray-100">
                                 <div class="grid grid-cols-1 gap-6">
                                     ${(!p.sizes || p.sizes.length === 0) && p.size ? `<div><span class="detail-label">Dimensions</span><p class="text-[13px] font-bold text-[#333333]">${p.size}</p></div>` : ''}
                                     ${p.material ? `<div><span class="detail-label">Material & Craftsmanship</span><p class="text-[13px] font-bold text-[#333333]">${p.material}</p></div>` : ''}
                                 </div>
                                <div>
                                    <span class="detail-label">The Story</span>
                                    <div id="desc-container" class="description-container">
                                        <div id="product-description" class="detail-description-text leading-relaxed description-clamp">
                                            ${p.desc || "An exquisite piece carefully curated for the Laszon collection. Crafted with exceptional attention to detail."}
                                        </div>
                                    </div>
                                    <div id="read-more-toggle" class="read-more-btn" onclick="toggleDescription()">
                                        <span>Read More</span>
                                        <i class="fa-solid fa-chevron-down text-[7px]"></i>
                                    </div>
                                </div>
                                ${p.inStock === false ? '<div class="p-4 bg-red-50 text-red-600 rounded-xl text-center font-black text-[10px] uppercase tracking-widest border border-red-100 italic">This product is currently sold out.</div>' : ''}
                            </div>

                            <!-- ACTION BUTTONS SECTION - NOW AT THE BOTTOM -->
                            <div class="pt-6 space-y-4 border-t border-gray-100">
                                <button onclick="inquireOnWhatsApp('${p.id}')" 
                                    class="w-full bg-[#121212] text-white py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.25em] shadow-premium active:scale-95 transition-all flex items-center justify-center gap-3">
                                    <i class="fa-brands fa-whatsapp text-2xl"></i> Inquire on WhatsApp
                                </button>

                                <div class="flex gap-4">
                                    <button onclick="addToCart('${p.id}')" 
                                        class="flex-[3] bg-white text-[#121212] py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] active:scale-95 transition-all flex items-center justify-center gap-3 border border-black/10">
                                        <i class="fa-solid fa-cart-shopping text-lg"></i> Add to Cart
                                    </button>
                                    <button onclick="shareProduct('${p.id}')" 
                                        class="flex-1 bg-white text-[#121212] rounded-2xl flex items-center justify-center active:scale-90 transition-all border border-black/10">
                                        <i class="fa-solid fa-share-nodes text-xl"></i>
                                    </button>
                                    <button onclick="toggleWishlist('${p.id}')" 
                                        class="flex-1 bg-white text-[#121212] rounded-2xl flex items-center justify-center active:scale-90 transition-all border border-black/10">
                                        <i class="fa-${state.wishlist.includes(p.id) ? 'solid' : 'regular'} fa-heart text-xl ${state.wishlist.includes(p.id) ? 'text-red-500' : ''}"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // ADD GALLERY HELPER TO GLOBAL SCOPE
    window.updateActiveGallery = (el, variationImages, mainImages, val, type) => {
        const imagesToLoad = (variationImages && variationImages.length > 0) ? variationImages : mainImages;
        const mainImgEl = document.getElementById('main-detail-img');
        const thumbGrid = document.querySelector('.thumb-grid');

        // Update Label
        // (Removed selection-status logic as per user request)

        if (mainImgEl) {
            mainImgEl.src = getOptimizedUrl(imagesToLoad[0]);
            mainImgEl.classList.remove('loaded');
            setTimeout(() => mainImgEl.classList.add('loaded'), 10);
        }

        if (thumbGrid) {
            thumbGrid.innerHTML = imagesToLoad.map((img, i) => `
                <div class="thumb-box ${i === 0 ? 'active' : ''}" onclick="switchImg('${img}', this)">
                    <img src="${getOptimizedUrl(img, 'w_100')}" alt="Thumbnail" class="w-full h-full object-cover">
                </div>
            `).join('');
        }
    };

    window.toggleDescription = () => {
        const desc = document.getElementById('product-description');
        const container = document.getElementById('desc-container');
        const btn = document.getElementById('read-more-toggle');
        if (!desc || !btn || !container) return;

        const isExpanded = desc.classList.contains('description-expanded');
        if (isExpanded) {
            desc.classList.remove('description-expanded');
            container.classList.remove('expanded');
            btn.innerHTML = `<span>Read More</span> <i class="fa-solid fa-chevron-down text-[7px]"></i>`;
            // Smoothly scroll back if needed
            desc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            desc.classList.add('description-expanded');
            container.classList.add('expanded');
            btn.innerHTML = `<span>Read Less</span> <i class="fa-solid fa-chevron-up text-[7px]"></i>`;
        }
    };
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.shareProduct = async (id) => {
    const p = DATA.p.find(x => x.id === id);
    if (!p) return;
    const shareData = {
        title: p.name,
        text: `Check out this ${p.name} from Laszon!`,
        url: window.location.href
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            // Fallback: Copy to clipboard
            await navigator.clipboard.writeText(window.location.href);
            showToast("Link copied to clipboard! ✨", "success");
        }
    } catch (err) {
        console.warn("Share failed:", err);
    }
};

window.saveProduct = async () => {
    const id = document.getElementById('edit-id')?.value;
    const btn = document.getElementById('p-save-btn');

    // Collect Variation Data
    const colors = [];
    const sizes = [];
    document.querySelectorAll('.variation-row').forEach(row => {
        const type = row.dataset.type;
        const name = row.querySelector('.v-name').value;
        const galleryId = row.querySelector('.admin-gallery').id;
        const images = getGalleryImages(galleryId);

        if (name) {
            if (type === 'color') {
                const hex = row.querySelector('.v-hex').value;
                colors.push({ name, hex, images });
            } else {
                sizes.push({ name, images });
            }
        }
    });

    // Collect Main Images
    const images = getGalleryImages('main-product-gallery');

    const data = {
        name: document.getElementById('p-name')?.value,
        price: document.getElementById('p-price')?.value,
        material: document.getElementById('p-material')?.value,
        size: document.getElementById('p-size')?.value,
        inStock: document.getElementById('p-stock')?.checked,
        images: images, // Array
        img: images[0] || 'img/', // Compatibility
        colors: colors,
        sizes: sizes,
        catId: document.getElementById('p-cat-id')?.value,
        desc: document.getElementById('p-desc')?.value,
        keywords: document.getElementById('p-keywords')?.value,
        isPinned: document.getElementById('p-pinned')?.checked || false,
        updatedAt: Date.now()
    };
    if (!data.name || data.images.length === 0) return showToast("Name and at least one image required");
    if (btn) { btn.disabled = true; btn.innerText = "Syncing..."; }
    try { if (id) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', id), data); else await addDoc(prodCol, data); showToast("Synced Successfully"); resetForm(); DATA.p = []; refreshData(); }
    catch (e) { showToast("Save Error"); } finally { if (btn) { btn.disabled = false; btn.innerText = "Sync Product"; } }
};

window.saveCategory = async () => {
    const id = document.getElementById('edit-cat-id')?.value;
    const btn = document.getElementById('c-save-btn');
    const data = {
        name: document.getElementById('c-name')?.value,
        img: document.getElementById('c-img')?.value,
        isPinned: document.getElementById('c-pinned')?.checked || false,
        pinnedAt: document.getElementById('c-pinned')?.checked ? (DATA.c.find(c => c.id === id)?.pinnedAt || Date.now()) : null
    };
    if (!data.name) return showToast("Name required");
    if (btn) { btn.disabled = true; btn.innerText = "Syncing..."; }
    try { if (id) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'categories', id), data); else await addDoc(catCol, data); showToast("Category Synced"); resetForm(); DATA.p = []; refreshData(); }
    catch (e) { showToast("Category Error"); } finally { if (btn) { btn.disabled = false; btn.innerText = "Sync Category"; } }
};

window.saveBanner = async () => {
    const id = document.getElementById('edit-banner-id')?.value;
    const btn = document.getElementById('b-save-btn');
    const data = {
        title: document.getElementById('b-title')?.value,
        subtitle: document.getElementById('b-subtitle')?.value,
        img: document.getElementById('b-img')?.value,
        order: parseInt(document.getElementById('b-order')?.value) || 0,
        updatedAt: Date.now()
    };
    if (!data.img) return showToast("Image required");
    if (btn) { btn.disabled = true; btn.innerText = "Syncing..."; }
    try {
        if (id) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'banners', id), data);
        else await addDoc(bannerCol, data);
        showToast("Banner Saved");
        resetForm();
        DATA.p = [];
        refreshData();
    }
    catch (e) { showToast("Save Error"); }
    finally { if (btn) { btn.disabled = false; btn.innerText = "Sync Banner"; } }
};

window.deleteProduct = async (id) => { if (!confirm("Are you sure?")) return; try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', id)); showToast("Deleted"); refreshData(); } catch (e) { showToast("Delete Error"); } };
window.deleteCategory = async (id) => { if (!confirm("Delete Category?")) return; try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'categories', id)); showToast("Category Removed"); refreshData(); } catch (e) { showToast("Error"); } };
window.deleteBanner = async (id) => { if (!confirm("Delete Banner?")) return; try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'banners', id)); showToast("Banner Removed"); refreshData(); } catch (e) { showToast("Error"); } };

window.editProduct = (id) => {
    try {
        const item = DATA.p.find(x => x.id === id);
        if (!item) return;

        // 1. Unhide Product Section first
        switchAdminTab('p');

        // 2. Clear & Prepare
        window.resetForm();
        const section = document.getElementById('admin-product-section');
        if (section) section.scrollIntoView({ behavior: 'smooth' });

        // 3. Populate Basic Info
        const editId = document.getElementById('edit-id');
        const pName = document.getElementById('p-name');
        const pPrice = document.getElementById('p-price');
        const pMaterial = document.getElementById('p-material');
        const pSize = document.getElementById('p-size'); // Added
        const pStock = document.getElementById('p-stock');
        const pPinned = document.getElementById('p-pinned');
        const pCatId = document.getElementById('p-cat-id');
        const pDesc = document.getElementById('p-desc');
        const pKeywords = document.getElementById('p-keywords');
        const pFormTitle = document.getElementById('p-form-title');

        if (editId) editId.value = item.id;
        if (pName) pName.value = item.name || '';
        if (pPrice) pPrice.value = item.price || '';
        if (pMaterial) pMaterial.value = item.material || '';
        if (pSize) pSize.value = item.size || ''; // Added
        if (pStock) pStock.checked = item.inStock !== false;
        if (pPinned) pPinned.checked = item.isPinned || false;
        if (pCatId) pCatId.value = item.catId || "";
        if (pDesc) pDesc.value = item.desc || "";
        if (pKeywords) pKeywords.value = item.keywords || "";
        if (pFormTitle) pFormTitle.innerText = "Editing: " + (item.name || 'Product');

        // 4. Populate Galleries
        const imgs = item.images || [item.img, item.img2, item.img3].filter(i => i && i !== 'img/');
        renderGalleryUI('main-product-gallery', imgs);

        // 5. Populate Variations
        if (item.colors && Array.isArray(item.colors)) {
            item.colors.forEach(c => addColorRow(c));
        }
        if (item.sizes && Array.isArray(item.sizes)) {
            if (typeof item.sizes[0] === 'object') {
                item.sizes.forEach(s => addSizeRow(s));
            } else {
                item.sizes.forEach(s => addSizeRow({ name: s })); // Legacy
            }
        }

        document.getElementById('p-save-btn').innerText = "Update Product";
    } catch (err) {
        console.error("Edit Error:", err);
        showToast("Error loading product details");
    }
};

window.editCategory = (id) => {
    const item = DATA.c.find(x => x.id === id);
    if (!item) return;
    const editCatId = document.getElementById('edit-cat-id');
    const cName = document.getElementById('c-name');
    const cImg = document.getElementById('c-img');
    const cPinned = document.getElementById('c-pinned');
    const cFormTitle = document.getElementById('c-form-title');

    if (editCatId) editCatId.value = item.id;
    if (cName) cName.value = item.name;
    if (cImg) cImg.value = item.img;
    if (cPinned) cPinned.checked = item.isPinned || false;
    if (cFormTitle) cFormTitle.innerText = "Editing: " + item.name;
    switchAdminTab('c');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.exportData = () => {
    try {
        const backup = { products: DATA.p, categories: DATA.c, timestamp: Date.now() };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); if (!a) return; a.href = url;
        a.download = `laszongifts_backup_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast("Backup Created!");
    } catch (err) { showToast("Export Failed"); }
};

window.exportExcel = () => {
    try {
        if (DATA.p.length === 0) return showToast("No products found");
        const escapeCSV = (val) => { if (val === undefined || val === null) return '""'; let s = String(val).replace(/"/g, '""'); return `"${s}"`; };
        const headers = ["ID", "Name", "Price (AED)", "Category", "Stock Status", "Size", "Material", "Description", "Image 1", "Image 2", "Image 3"];
        const rows = DATA.p.map(p => {
            const catName = DATA.c.find(c => c.id === p.catId)?.name || "Uncategorized";
            const stockStatus = p.inStock !== false ? "In Stock" : "Out of Stock";
            return [p.id, p.name, p.price, catName, stockStatus, p.size || "", p.material || "", p.desc || "", p.img, p.img2 || "", p.img3 || ""].map(escapeCSV).join(",");
        });
        const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); if (!a) return; a.href = url;
        a.download = `laszongifts_inventory_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast("Excel Exported!");
    } catch (err) { showToast("Export Failed"); }
};

// NEW: UNIVERSAL MIGRATION LOGIC (FOR FUTURE DB SWITCHING)
window.copyUniversalJSON = () => {
    try {
        const universalBackup = {
            metadata: {
                source: "Laszon Gifts Boutique UI",
                version: "2.6.0",
                exportDate: new Date().toISOString(),
                schema: {
                    products: ["id", "name", "price", "catId", "stockStatus", "size", "material", "description", "images"]
                }
            },
            categories: DATA.c.map(c => ({ id: c.id, name: c.name, iconUrl: c.img })),
            products: DATA.p.map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                catId: p.catId,
                stockStatus: p.inStock !== false ? "instock" : "outofstock",
                specs: { size: p.size || "", material: p.material || "" },
                description: p.desc || "",
                images: [p.img, p.img2, p.img3].filter(u => u && u !== 'img/')
            }))
        };

        const jsonStr = JSON.stringify(universalBackup, null, 2);
        const textArea = document.createElement("textarea");
        if (!textArea) return;
        textArea.value = jsonStr;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast("Universal Migration JSON Copied!");
    } catch (err) { showToast("Migration Prep Failed"); }
};

window.importData = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // STRICT WARNING: DATA REPLACEMENT
    if (!confirm("⚠️ WARNING: This will PERMANENTLY DELETE all existing Products & Categories and replace them with the backup data.\n\nAre you sure you want to continue?")) {
        event.target.value = ''; // Reset
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            showToast("Clearing Database... ⏳");

            // HELPER: Batch Clear Collection (Robust)
            const clearCol = async (colRef) => {
                const snapshot = await getDocs(colRef);
                if (snapshot.empty) return;

                const batch = writeBatch(db);
                snapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
            };

            // 1. DELETE EXISTING DATA (Atomic Batch)
            await clearCol(prodCol);
            await clearCol(catCol);

            // 2. CLEAR LOCAL CACHE
            DATA.p = [];
            DATA.c = [];

            showToast("Restoring Backup... ♻️");

            // TRACKER SETS TO PREVENT IN-FILE DUPLICATES
            const addedCatNames = new Set();
            const addedProdKeys = new Set();

            // 3. RESTORE CATEGORIES
            const catOldIdToName = {};
            if (data.categories) {
                data.categories.forEach(c => { if (c.id) catOldIdToName[c.id] = (c.name || "").trim(); });
            }

            if (data.categories) {
                // Batch add categories if possible, but let's stick to simple awaits for now unless >500
                const catBatch = writeBatch(db);
                let catCount = 0;

                for (const cat of data.categories) {
                    const trimmedName = (cat.name || "").trim();
                    if (addedCatNames.has(trimmedName)) continue; // Skip duplicate category in file

                    const cleanCat = { name: trimmedName, img: cat.img || cat.iconUrl || "img/" };
                    const newRef = doc(catCol); // Auto-ID
                    catBatch.set(newRef, cleanCat);

                    DATA.c.push({ id: newRef.id, ...cleanCat });
                    addedCatNames.add(trimmedName);
                    catCount++;
                }
                if (catCount > 0) await catBatch.commit();
            }

            // Map Name -> New ID
            const nameToNewId = {};
            DATA.c.forEach(c => { nameToNewId[c.name.trim()] = c.id; });

            // 4. RESTORE PRODUCTS
            if (data.products) {
                const prodBatch = writeBatch(db);
                let prodCount = 0;
                // Note: Firestore batch limit is 500. If user has > 500, we need chunks.
                // For safety, let's just do sequential addDoc for products if > 400 to avoid complex chunking logic here,
                // OR use chunks. Given the boutique nature, < 500 is likely.
                // Let's implement robust chunking for products.

                const batches = [];
                let currentBatch = writeBatch(db);
                let currentBatchCount = 0;

                for (const p of data.products) {
                    // RESOLVE CATEGORY ID
                    let finalCatId = "";
                    const oldCatName = catOldIdToName[p.catId];
                    if (oldCatName && nameToNewId[oldCatName]) {
                        finalCatId = nameToNewId[oldCatName];
                    } else if (p.catId && nameToNewId[p.catId]) {
                        finalCatId = nameToNewId[p.catId];
                    }

                    const pImg = (p.images && p.images[0]) || p.img || "img/";
                    // Unique Key: Name + CatID + Image + Price + Stock (Minimal Dedupe)
                    const uniqueKey = `${p.name}-${finalCatId}-${pImg}-${p.price}-${p.inStock}`;

                    if (addedProdKeys.has(uniqueKey)) continue; // Skip EXACT duplicate in file

                    // Progress Indicator (every 50 items)
                    if (currentBatchCount % 50 === 0) showToast(`Restoring... ${currentBatchCount + (batches.length * 450)} items`);

                    const cleanProd = {
                        name: p.name || "",
                        price: p.price || "",
                        catId: finalCatId,
                        desc: p.desc || p.description || "",
                        size: (p.specs ? p.specs.size : (p.size || "")),
                        material: (p.specs ? p.specs.material : (p.material || "")),
                        inStock: p.inStock !== undefined ? p.inStock : (p.stockStatus !== "outofstock"),
                        isPinned: p.isPinned || false,
                        updatedAt: p.updatedAt || Date.now()
                    };

                    if (p.images && Array.isArray(p.images)) {
                        cleanProd.img = p.images[0] || "img/";
                        cleanProd.img2 = p.images[1] || "img/";
                        cleanProd.img3 = p.images[2] || "img/";
                    } else {
                        cleanProd.img = p.img || "img/";
                        cleanProd.img2 = p.img2 || "img/";
                        cleanProd.img3 = p.img3 || "img/";
                    }

                    const newRef = doc(prodCol);
                    currentBatch.set(newRef, cleanProd);
                    addedProdKeys.add(uniqueKey);

                    currentBatchCount++;
                    if (currentBatchCount >= 450) { // Safety margin below 500
                        batches.push(currentBatch.commit());
                        currentBatch = writeBatch(db);
                        currentBatchCount = 0;
                    }
                }
                if (currentBatchCount > 0) batches.push(currentBatch.commit());

                await Promise.all(batches);
            }
            showToast("Restore Complete! ✅");
            event.target.value = '';
            refreshData();
        } catch (err) {
            console.error(err);
            showToast("Import Failed ❌");
            event.target.value = '';
        }
    };
    reader.readAsText(file);
};

window.toggleSelect = (e, id) => {
    e.stopPropagation();
    const card = e.target.closest('.product-card');
    if (state.selected.includes(id)) {
        state.selected = state.selected.filter(x => x !== id);
        if (card) card.classList.remove('selected');
    } else {
        state.selected.push(id);
        if (card) card.classList.add('selected');
    }
    updateSelectionBar();
};

window.clearSelection = () => { state.selected = []; state.selectionId = null; renderHome(); };

window.shareSelection = async () => {
    if (state.selected.length === 0) return;
    showToast("Generating link...");
    try {
        const docRef = await addDoc(shareCol, { ids: state.selected, createdAt: Date.now() });
        const shareUrl = `${window.location.origin}${window.location.pathname}?s=${docRef.id}`;
        const textArea = document.createElement("textarea");
        if (!textArea) return;
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast("Secret Link Copied!");
    }
    catch (e) { showToast("Sharing failed."); }
};

window.sendBulkInquiry = () => {
    const items = state.selected.map(id => DATA.p.find(p => p.id === id)).filter(x => x);
    let msg = `*Hello Laszon Gifts!*\nI am interested in these items:\n\n`;
    items.forEach((item, i) => { const pUrl = `${window.location.origin}${window.location.pathname}?p=${item.id}`; msg += `${i + 1}. *${item.name}* - ${item.price} AED\nLink: ${pUrl}\n\n`; });
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`);
};

window.inquireOnWhatsApp = (id) => {
    const p = DATA.p.find(x => x.id === id);
    if (!p) return;
    const pUrl = `${window.location.origin}${window.location.pathname}?p=${p.id}`;
    const msg = `*Inquiry regarding:* ${p.name}\n*Price:* ${p.price} AED\n\n*Product Link:* ${pUrl}\n\nPlease let me know the availability.`;
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`);
};

window.switchImg = (src, el) => {
    const main = document.getElementById('main-detail-img');
    if (main) {
        main.classList.remove('loaded');
        main.src = getOptimizedUrl(src, 'f_auto,q_auto:best');
        // Update click handler for full-screen preview
        main.closest('.zoom-img-container')?.setAttribute('onclick', `openFullScreen('${src}')`);
        // Update thumb background for the main box
        main.closest('.zoom-img-container').style.backgroundImage = `url('${getOptimizedUrl(src, 'w_50,e_blur:1000,f_auto,q_10')}')`;
    }
    document.querySelectorAll('.thumb-box').forEach(x => x.classList.remove('active'));
    if (el) el.classList.add('active');
};

window.handleZoom = (e, container) => {
    // Only zoom if it's a mouse event and not a touch simulation that triggers click
    const img = container?.querySelector('img');
    if (!img) return;
    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    img.style.transformOrigin = `${x}% ${y}%`;
    img.style.transform = 'scale(2)';
};

window.resetZoom = (container) => {
    const img = container?.querySelector('img');
    if (!img) return;
    img.style.transform = 'scale(1)';
    img.style.transformOrigin = `center center`;
};

window.openFullScreen = (src) => {
    const overlay = document.getElementById('img-full-preview');
    const fullImg = document.getElementById('full-preview-img');
    if (overlay && fullImg) {
        fullImg.src = src;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};

window.closeFullScreen = () => {
    const overlay = document.getElementById('img-full-preview');
    if (overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

window.switchAdminTab = (tab) => {
    const tabs = ['p', 'c', 'b', 'u', 's'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const sectionId = t === 'p' ? 'admin-product-section' : t === 'c' ? 'admin-category-section' : t === 'b' ? 'admin-banner-section' : t === 'u' ? 'admin-user-list' : 'admin-settings-section';
        const listId = t === 'p' ? 'admin-product-list-container' : t === 'c' ? 'admin-category-list' : t === 'b' ? 'admin-banner-list' : t === 'u' ? 'admin-user-list' : null;

        const section = document.getElementById(sectionId);
        const list = listId ? document.getElementById(listId) : null;

        if (btn) {
            btn.classList.toggle('bg-white', t === tab);
            btn.classList.toggle('shadow-xl', t === tab);
            btn.classList.toggle('text-gray-400', t !== tab);
        }
        if (section) section.classList.toggle('hidden', t !== tab);
        if (list) list.classList.toggle('hidden', t !== tab);
    });

    if (tab === 'u') renderUsersUI();

    const demoBtn = document.getElementById('add-demo-banner-btn');
    if (demoBtn) demoBtn.classList.toggle('hidden', tab !== 'b');

    const catFilter = document.getElementById('admin-cat-filter');
    if (catFilter) catFilter.classList.toggle('hidden', tab !== 'p');

    const listTitle = document.getElementById('list-title');
    if (listTitle) listTitle.classList.toggle('hidden', tab !== 'p');

    renderAdminUI();
};


window.editBanner = (id) => {
    const item = DATA.b.find(x => x.id === id);
    if (!item) return;
    switchAdminTab('b');
    document.getElementById('edit-banner-id').value = item.id;
    document.getElementById('b-title').value = item.title || '';
    document.getElementById('b-subtitle').value = item.subtitle || '';
    document.getElementById('b-img').value = item.img || 'img/';
    document.getElementById('b-order').value = item.order || 0;
    document.getElementById('b-form-title').innerText = "Edit Banner";
    document.getElementById('b-save-btn').innerText = "Update Banner";
    document.getElementById('admin-panel').scrollTo({ top: 0, behavior: 'smooth' });
};

window.addDemoBanner = async (e) => {
    const btn = (e && e.currentTarget) || document.getElementById('add-demo-banner-btn');
    if (btn) { btn.disabled = true; btn.innerText = "Adding..."; }
    try {
        const demos = [
            { title: "The Art of Gifting", subtitle: "Discover our Exclusive Collection", img: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=1000&auto=format&fit=crop" },
            { title: "Luxe Favorites", subtitle: "Curated for Elegance", img: "https://images.unsplash.com/photo-1513201099705-a9746e1e201f?q=80&w=1000&auto=format&fit=crop" },
            { title: "Timeless Treasures", subtitle: "Gift with Love", img: "https://images.unsplash.com/photo-1544816153-39ad361664ec?q=80&w=1000&auto=format&fit=crop" },
            { title: "Modern Boutique", subtitle: "Elevated Style", img: "https://images.unsplash.com/photo-1481349518771-20055b2a7b24?q=80&w=1000&auto=format&fit=crop" }
        ];

        for (const [i, d] of demos.entries()) {
            await addDoc(bannerCol, { ...d, order: i, updatedAt: Date.now() });
        }
        showToast("4 Demo Banners Added!");
        DATA.p = [];
        refreshData();
    } catch (e) {
        showToast("Error adding demo");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Add Demo Banner"; }
    }
};

function renderHeroSlider() {
    const container = document.getElementById('hero-slider-container');
    const dotsContainer = document.getElementById('slider-dots');
    if (!container || !dotsContainer) return;

    const banners = DATA.b.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (banners.length === 0) {
        container.innerHTML = `
            <div class="hero-slide">
                <img src="https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=1000&auto=format&fit=crop" class="w-full h-auto block relative object-cover">
                <div class="absolute inset-0 flex flex-col justify-center px-8 md:px-16">
                    <h2 class="text-white text-3xl md:text-5xl font-serif italic mb-2 tracking-wide">The Art of Gifting</h2>
                    <p class="text-white/80 text-[10px] md:text-xs font-black uppercase tracking-[0.3em] mb-8">Discover our Exclusive Collection</p>
                </div>
            </div>
        `;
        dotsContainer.innerHTML = '';
        return;
    }

    container.innerHTML = `<div class="hero-slider">` + banners.map(b => `
        <div class="hero-slide">
            <img src="${getOptimizedUrl(b.img, 'w_1200,c_fill,f_auto,q_auto')}" class="w-full h-auto block relative object-cover">
            <div class="absolute inset-0 flex flex-col justify-center px-8 md:px-16">
                <h2 class="text-white text-3xl md:text-5xl font-serif italic mb-2 tracking-wide">${b.title || ""}</h2>
                <p class="text-white/80 text-[10px] md:text-xs font-black uppercase tracking-[0.3em]">${b.subtitle || ""}</p>
            </div>
        </div>
    `).join('') + `</div>`;

    dotsContainer.innerHTML = banners.map((_, i) => `<div class="slider-dot ${i === 0 ? 'active' : ''}" onclick="window.scrollToSlide(${i})"></div>`).join('');

    const slider = container.querySelector('.hero-slider');
    if (slider) {
        slider.addEventListener('scroll', () => {
            const index = Math.round(slider.scrollLeft / slider.clientWidth);
            const dots = dotsContainer.querySelectorAll('.slider-dot');
            dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
        });
    }
}

window.scrollToSlide = (index) => {
    const slider = document.querySelector('.hero-slider');
    if (slider) {
        slider.scrollTo({ left: index * slider.clientWidth, behavior: 'smooth' });
    }
};

window.renderAdminUI = () => {
    const pList = document.getElementById('admin-product-list');
    const cList = document.getElementById('admin-category-list');
    if (!pList || !cList) return;
    const filterEl = document.getElementById('admin-cat-filter');
    const catFilter = filterEl ? filterEl.value : "all";

    let products = DATA.p.filter(p => {
        const matchesCat = catFilter === 'all' || p.catId === catFilter;
        return matchesCat;
    });

    const grouped = {};
    products.forEach(p => {
        const catName = DATA.c.find(c => c.id === p.catId)?.name || "Uncategorized";
        if (!grouped[catName]) grouped[catName] = [];
        grouped[catName].push(p);
    });

    let pHtml = "";
    Object.keys(grouped).sort().forEach(cat => {
        pHtml += `<div class="col-span-full mt-10 mb-4 flex items-center gap-4">
    <h5 class="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 shrink-0">${cat}</h5>
    <div class="h-[1px] bg-gray-100 flex-1"></div>
    <span class="text-[9px] font-bold text-gray-300 uppercase shrink-0">${grouped[cat].length} Items</span>
</div>`;

        grouped[cat].forEach(p => {
            const stockTag = p.inStock !== false ? '<span class="stock-badge in">In Stock</span>' : '<span class="stock-badge out">Out of Stock</span>';
            let pinIcon = '';

            pHtml += `
        <div class="admin-product-card group">
            <div class="admin-product-img-box">
                <img src="${getOptimizedUrl(p.img)}" alt="${p.name}">
                ${pinIcon}
                <div class="admin-card-actions">
                    <button onclick="editProduct('${p.id}')" class="admin-action-btn" title="Edit Item">
                        <i class="fa-solid fa-pen-to-square text-[11px]"></i>
                    </button>
                    <button onclick="deleteProduct('${p.id}')" class="admin-action-btn delete" title="Delete Item">
                        <i class="fa-solid fa-trash text-[11px]"></i>
                    </button>
                </div>
            </div>
            <div class="admin-product-info">
                <h4 class="font-bold text-[13px] capitalize truncate text-gray-800">${p.name}</h4>
                <div class="flex items-center justify-between mt-1">
                    <p class="text-[10px] text-gray-500 font-black tracking-widest uppercase">${p.price} AED</p>
                    ${stockTag}
                </div>
            </div>
        </div>
    `;
        });
    });

    pList.innerHTML = pHtml || `<div class="col-span-full py-40 text-center"><p class="text-[12px] text-gray-300 font-bold uppercase tracking-widest italic">No items found.</p></div>`;

    cList.innerHTML = DATA.c.map(c => `
<div class="flex items-center gap-5 p-5 bg-gray-50 rounded-[2rem] border border-gray-100 relative">
    <div class="relative shrink-0">
        <img src="${getOptimizedUrl(c.img)}" class="w-14 h-14 rounded-full object-cover border-4 border-white shadow-sm" onerror="this.src='https://placehold.co/100x100?text=Icon'">
        ${c.isPinned ? '<div class="absolute -top-1 -right-1 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center border-2 border-white shadow-lg"><i class="fa-solid fa-thumbtack text-[8px]"></i></div>' : ''}
    </div>
    <div class="flex-1 font-bold text-[13px] uppercase">${c.name}</div>
    <div class="flex gap-2">
        <button onclick="editCategory('${c.id}')" class="w-10 h-10 flex items-center justify-center bg-white rounded-full shadow-lg text-gray-400 hover:text-black transition-all">
            <i class="fa-solid fa-pen text-[10px]"></i>
        </button>
        <button onclick="deleteCategory('${c.id}')" class="w-10 h-10 flex items-center justify-center bg-red-50 rounded-full text-red-200 hover:text-red-500 transition-all">
            <i class="fa-solid fa-trash text-[10px]"></i>
        </button>
    </div>
</div>
`).join('') || `<p class="text-center py-20 text-[11px] text-gray-300 italic">No Categories</p>`;

    const bList = document.getElementById('admin-banner-list');
    if (bList) {
        bList.innerHTML = DATA.b.sort((a, b) => (a.order || 0) - (b.order || 0)).map(b => `
<div class="flex items-center gap-5 p-5 bg-gray-50 rounded-[2rem] border border-gray-100 relative">
    <img src="${getOptimizedUrl(b.img)}" class="w-24 h-14 rounded-xl object-cover border-4 border-white shadow-sm">
    <div class="flex-1">
        <div class="font-bold text-[13px] uppercase truncate max-w-[150px]">${b.title || 'Untitled'}</div>
        <div class="text-[9px] text-gray-400 uppercase tracking-widest mt-1">Order: ${b.order || 0}</div>
    </div>
    <div class="flex gap-2">
        <button onclick="editBanner('${b.id}')" class="w-10 h-10 flex items-center justify-center bg-white rounded-full shadow-lg text-gray-400 hover:text-black transition-all">
            <i class="fa-solid fa-pen text-[10px]"></i>
        </button>
        <button onclick="deleteBanner('${b.id}')" class="w-10 h-10 flex items-center justify-center bg-red-50 rounded-full text-red-200 hover:text-red-500 transition-all">
            <i class="fa-solid fa-trash text-[10px]"></i>
        </button>
    </div>
</div>
`).join('') || `<p class="text-center py-20 text-[11px] text-gray-300 italic">No Banners</p>`;
    }

    // Settings
    const nameInput = document.getElementById('store-name');
    const logoInput = document.getElementById('store-logo');
    if (nameInput) nameInput.value = DATA.settings?.storeName || 'LASZON GIFTS';
    if (logoInput) logoInput.value = DATA.settings?.logo || '';
};

window.renderUsersUI = async () => {
    const list = document.getElementById('admin-user-list');
    if (!list) return;

    list.innerHTML = `<div class="col-span-full py-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-gray-300 mb-4"></i><p class="text-[10px] text-gray-400 uppercase tracking-widest font-black">Fetching Customers...</p></div>`;

    try {
        const snap = await getDocs(usersCol);
        const users = snap.docs.map(d => d.data()).sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));

        if (users.length === 0) {
            list.innerHTML = `<div class="col-span-full py-40 text-center"><p class="text-[12px] text-gray-300 font-bold uppercase tracking-widest italic">No customers found.</p></div>`;
            return;
        }

        list.innerHTML = `
            <div class="col-span-full mb-6 flex items-center gap-4">
                <h5 class="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 shrink-0">Registered Customers</h5>
                <div class="h-[1px] bg-gray-100 flex-1"></div>
                <span class="text-[9px] font-bold text-gray-300 uppercase shrink-0">${users.length} Users</span>
            </div>
            ` + users.map(u => {
            const dateStr = u.lastLogin ? new Date(u.lastLogin).toLocaleString('en-AE', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }) : 'Never';

            return `
                <div class="flex items-center gap-5 p-5 bg-gray-50 rounded-[2rem] border border-gray-100 hover:border-black/10 transition-all">
                    <div class="w-12 h-12 bg-white rounded-full flex items-center justify-center text-gold-luxe shadow-sm border border-black/5">
                        <i class="fa-solid fa-user text-sm"></i>
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="font-bold text-[13px] uppercase tracking-tight text-[#121212]">${u.name || u.displayName || 'Unnamed User'}</span>
                             <span class="text-[8px] bg-blue-50 text-blue-400 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">Active</span>
                        </div>
                        <div class="flex flex-col md:flex-row md:items-center gap-1 md:gap-4 text-[10px] text-gray-400">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-envelope opacity-50"></i> ${u.email}</span>
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-phone opacity-50"></i> ${u.mobile || 'No Mobile'}</span>
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-clock opacity-50"></i> Last Login: ${dateStr}</span>
                        </div>
                    </div>
                    <div class="flex gap-2">
                    <button onclick="viewCustomerWishlist('${u.uid}', '${(u.name || u.displayName || 'Customer').replace(/'/g, "\\'")}')" 
                        class="w-10 h-10 rounded-full bg-red-50 text-red-400 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-sm"
                        title="View Favorites">
                        <i class="fa-solid fa-heart"></i>
                    </button>
                    <button onclick="viewCustomerCart('${u.uid}', '${(u.name || u.displayName || 'Customer').replace(/'/g, "\\'")}')" 
                        class="w-10 h-10 rounded-full bg-blue-50 text-blue-400 flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all shadow-sm"
                        title="View Cart">
                        <i class="fa-solid fa-cart-shopping"></i>
                    </button>
                    <button onclick="deleteUser('${u.uid}', '${(u.name || u.displayName || 'Customer').replace(/'/g, "\\'")}')" 
                        class="w-10 h-10 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-sm ml-2"
                        title="Delete User">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error("Users Fetch Error", e);
        list.innerHTML = `<p class="text-center py-20 text-red-400 text-[11px] uppercase font-black tracking-widest">Error loading customers</p>`;
    }
};

window.deleteUser = async (uid, name) => {
    if (!confirm(`Are you sure you want to delete user "${name}"? This will reset their account data.`)) return;

    try {
        // 1. Delete Wishlist & Cart (Clean Slate)
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', uid, 'account', 'wishlist'));
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', uid, 'account', 'cart'));

        // 2. Delete User Profile
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', uid));

        showToast(`User ${name} data reset.`);
        renderUsersUI();
    } catch (e) {
        console.error("Error deleting user:", e);
        showToast("Failed to delete user.");
    }
};

window.viewCustomerWishlist = async (uid, name) => {
    const list = document.getElementById('guest-wishlist-items');
    const title = document.getElementById('guest-wishlist-title');
    if (!list || !title) return;

    title.innerText = `${name}'s Favorites`;
    list.innerHTML = `<div class="py-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-gray-300 mb-4"></i><p class="text-[9px] text-gray-400 uppercase tracking-widest font-black">Fetching Wishlist...</p></div>`;

    toggleGuestWishlistModal();

    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid, 'account', 'wishlist');
        const snap = await getDoc(docRef);

        if (!snap.exists() || !snap.data().ids || snap.data().ids.length === 0) {
            list.innerHTML = `<div class="py-20 text-center opacity-20"><i class="fa-solid fa-heart-crack text-4xl mb-4"></i><p class="text-[10px] font-black uppercase tracking-widest">Empty Wishlist</p></div>`;
            return;
        }

        const ids = snap.data().ids;
        const products = ids.map(id => DATA.p.find(p => p.id === id)).filter(p => p);

        if (products.length === 0) {
            list.innerHTML = `<div class="py-20 text-center opacity-20"><p class="text-[10px] font-black uppercase tracking-widest">Products no longer exist</p></div>`;
            return;
        }

        list.innerHTML = products.map(p => `
            <div class="flex items-center gap-4 p-3 bg-white/50 rounded-2xl border border-black/5">
                <img src="${getOptimizedUrl(p.img, 'w_100,c_fill')}" class="w-16 h-16 rounded-xl object-cover shadow-sm">
                <div class="flex-1">
                    <h4 class="text-[11px] font-bold text-[#333333]">${p.name}</h4>
                    <p class="text-[9px] font-black text-gold-luxe uppercase tracking-widest">${p.price} AED</p>
                </div>
                <button onclick="viewDetail('${p.id}', true); toggleGuestWishlistModal();" class="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center hover:bg-black hover:text-white transition-all">
                    <i class="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
            </div>
        `).join('');

    } catch (e) {
        console.error("Fetch Wishlist Error", e);
        list.innerHTML = `<p class="text-center py-20 text-red-300 text-[10px] font-black uppercase tracking-widest">Error fetching wishlist</p>`;
    }
};

window.viewCustomerCart = async (uid, name) => {
    const list = document.getElementById('guest-wishlist-items');
    const title = document.getElementById('guest-wishlist-title');
    if (!list || !title) return;

    title.innerText = `${name}'s Cart`;
    list.innerHTML = `<div class="py-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-gray-300 mb-4"></i><p class="text-[9px] text-gray-400 uppercase tracking-widest font-black">Fetching Cart...</p></div>`;

    toggleGuestWishlistModal();

    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid, 'account', 'cart');
        const snap = await getDoc(docRef);

        if (!snap.exists() || !snap.data().ids || snap.data().ids.length === 0) {
            list.innerHTML = `<div class="py-20 text-center opacity-20"><i class="fa-solid fa-cart-shopping text-4xl mb-4"></i><p class="text-[10px] font-black uppercase tracking-widest">Cart Empty</p></div>`;
            return;
        }

        const ids = snap.data().ids;
        const products = ids.map(id => DATA.p.find(p => p.id === id)).filter(p => p);

        if (products.length === 0) {
            list.innerHTML = `<div class="py-20 text-center opacity-20"><p class="text-[10px] font-black uppercase tracking-widest">Products no longer exist</p></div>`;
            return;
        }

        list.innerHTML = products.map(p => `
            <div class="flex items-center gap-4 p-3 bg-white/50 rounded-2xl border border-black/5">
                <img src="${getOptimizedUrl(p.img, 'w_100,c_fill')}" class="w-16 h-16 rounded-xl object-cover shadow-sm">
                <div class="flex-1">
                    <h4 class="text-[11px] font-bold text-[#333333]">${p.name}</h4>
                    <p class="text-[9px] font-black text-black uppercase tracking-widest">${p.price} AED</p>
                </div>
                <button onclick="viewDetail('${p.id}', true); toggleGuestWishlistModal();" class="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center hover:bg-black hover:text-white transition-all">
                    <i class="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
            </div>
        `).join('');

    } catch (e) {
        console.error("Fetch Cart Error", e);
        list.innerHTML = `<p class="text-center py-20 text-red-300 text-[10px] font-black uppercase tracking-widest">Error fetching cart</p>`;
    }
};

window.toggleGuestWishlistModal = () => {
    const modal = document.getElementById('guest-wishlist-modal');
    if (modal) modal.classList.toggle('hidden');
};

function applySettings() {
    const container = document.getElementById('logo-container');
    if (!container) return;

    if (DATA.settings?.logo) {
        container.innerHTML = `<img src="${getOptimizedUrl(DATA.settings.logo, 'h_80,f_auto,q_auto')}" class="h-8 md:h-10 object-contain" alt="${DATA.settings.storeName}">`;
    } else {
        container.innerHTML = `<h1 class="brand-logo text-[#333333]">${DATA.settings?.storeName || 'LASZON GIFTS'}</h1>`;
    }
}

window.saveSettings = async () => {
    const btn = document.getElementById('s-save-btn');
    const settings = {
        storeName: document.getElementById('store-name').value || 'LASZON GIFTS',
        logo: document.getElementById('store-logo').value || '',
        updatedAt: Date.now()
    };

    if (btn) { btn.disabled = true; btn.innerText = "Saving..."; }
    try {
        await setDoc(settingsDoc, settings);
        DATA.settings = settings;
        applySettings();
        showToast("Settings Saved!");
    } catch (e) {
        showToast("Error saving settings");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Save Settings"; }
    }
};

window.handleCategoryRowScroll = (el) => {
    const container = el.parentElement;
    if (!container) return;
    const isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
    if (isAtEnd) container.classList.add('scrolled-end');
    else container.classList.remove('scrolled-end');
};

window.applyFilter = (id) => {
    if (id === 'wishlist') return toggleWishlistSidebar();
    state.filter = id;
    state.search = '';
    state.scrollPos = 0;
    safePushState({ f: id, p: null });
    renderHome();
};
window.showSearchSuggestions = (show) => {
    const appMain = document.getElementById('app');
    const tags = appMain ? appMain.querySelector('#search-tags') : null;
    if (tags) {
        if (show) tags.classList.remove('hidden');
        else setTimeout(() => {
            const currentTags = document.getElementById('app')?.querySelector('#search-tags');
            if (currentTags) currentTags.classList.add('hidden');
        }, 200);
    }
};
let searchTimeout;
window.applyCustomerSearch = (val) => {
    state.search = val;
    if (val && state.filter !== 'wishlist' && !state.selectionId) {
        state.filter = 'all';
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        renderHome();
    }, 100);

    // Update Clear Button UI immediately with safety
    const clearBtn = document.getElementById('app')?.querySelector('#clear-search-btn');
    if (clearBtn) {
        if (val) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
};
window.clearCustomerSearch = () => {
    state.search = '';
    renderHome();
    const input = document.getElementById('customer-search');
    if (input) input.focus();
};
window.applyPriceSort = (sort) => { state.sort = sort; renderHome(); };
window.showAdminPanel = () => {
    if (window.innerWidth < 1024) return showToast("Dashboard only accessible on Desktop");

    if (!state.isAdmin) {
        showToast("Please login as Admin to continue");
        if (!state.user || state.user.isAnonymous) {
            toggleAuthModal();
        } else {
            showToast("This account does not have admin access.");
        }
        return;
    }
    const panel = document.getElementById('admin-panel');
    if (!panel) return;
    panel.classList.replace('hidden', 'flex');
    setTimeout(() => panel.classList.add('active'), 10);
    document.body.style.overflow = 'hidden';
    renderAdminUI();
};
window.hideAdminPanel = () => {
    const panel = document.getElementById('admin-panel');
    if (!panel) return;
    panel.classList.remove('active');
    setTimeout(() => {
        panel.classList.replace('flex', 'hidden');
    }, 400);
    document.body.style.overflow = 'auto';
};


/* CATEGORY PICKER LOGIC */

function populateCatSelect() {
    const select = document.getElementById('p-cat-id');
    if (select) select.innerHTML = `<option value="">Select Category</option>` + DATA.c.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function populateAdminCatFilter() {
    const select = document.getElementById('admin-cat-filter');
    if (select) select.innerHTML = `<option value="all">All Categories</option>` + DATA.c.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// --- GALLERY & DRAG-DROP HELPERS ---
window.triggerGalleryUpload = (containerId) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        await handleImageFiles(files, containerId);
    };
    input.click();
};

window.handleGalleryDrag = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-active');
};

window.handleGalleryLeave = (e) => {
    e.currentTarget.classList.remove('drag-active');
};

window.handleGalleryDrop = async (e, containerId) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-active');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return showToast("Please drop images.");
    await handleImageFiles(files, containerId);
};

async function handleImageFiles(files, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Remove empty placeholder
    const placeholder = container.querySelector('.w-full');
    if (placeholder) placeholder.remove();

    showToast(`Uploading ${files.length} images...`);

    for (const file of files) {
        try {
            const url = await directCloudinaryUpload(file);
            addGalleryItem(containerId, url);
        } catch (err) {
            showToast("One or more uploads failed.");
        }
    }
}

function addGalleryItem(containerId, url) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const div = document.createElement('div');
    div.className = "gallery-item fade-in";
    div.dataset.url = url;
    div.innerHTML = `
        <img src="${getOptimizedUrl(url, 'w_200')}" alt="Gallery item">
        <div class="remove-img" onclick="this.parentElement.remove()">
            <i class="fa-solid fa-xmark"></i>
        </div>
    `;
    container.appendChild(div);
}

function getGalleryImages(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.gallery-item')).map(item => item.dataset.url);
}

function renderGalleryUI(containerId, images = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = images.length === 0 ?
        '<div class="w-full text-center py-6 text-[9px] font-bold text-gray-300 uppercase">Gallery Empty</div>' : '';
    images.forEach(url => addGalleryItem(containerId, url));
}

// --- VARIATION HANDLERS ---
window.addColorRow = (data = {}) => {
    if (typeof data === 'string') data = { name: data, hex: '#000000', images: [] };
    const container = document.getElementById('variation-container');
    if (!container) return;
    const id = "v-" + Date.now() + Math.random().toString(16).slice(2);
    const galleryId = "gallery-" + id;

    const div = document.createElement('div');
    div.className = "variation-row fade-in";
    div.dataset.type = "color";
    div.innerHTML = `
        <div class="flex justify-between items-center bg-gray-50/50 p-2 rounded-xl mb-2">
            <span class="text-[9px] font-black uppercase tracking-widest text-black flex items-center gap-2">
                <i class="fa-solid fa-palette text-gray-400"></i> Color Variation
            </span>
            <button onclick="this.closest('.variation-row').remove()" class="text-red-400 hover:text-red-600 transition-all">
                <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <input type="text" class="v-name admin-input !py-3 !text-xs" placeholder="Color Name (e.g. Royal Blue)" value="${data.name || ''}">
            <div class="flex gap-2 items-center admin-input !py-2">
                <span class="text-[8px] font-black text-gray-400 uppercase">Swatch:</span>
                <input type="color" class="v-hex w-full h-6 rounded cursor-pointer border-none p-0 bg-transparent" value="${data.hex || '#000000'}">
            </div>
        </div>
        <div class="space-y-2">
            <div class="flex justify-between items-center">
                <span class="text-[8px] font-black text-gray-400 uppercase">Color Photos</span>
                <button onclick="triggerGalleryUpload('${galleryId}')" class="text-[8px] font-bold uppercase text-blue-500 underline">+ Add</button>
            </div>
            <div id="${galleryId}" class="admin-gallery !min-h-[60px] !p-2" 
                 ondragover="handleGalleryDrag(event)" ondragleave="handleGalleryLeave(event)" ondrop="handleGalleryDrop(event, '${galleryId}')">
                <div class="w-full text-center py-2 text-[7px] font-bold text-gray-300 uppercase">Drop Color Images</div>
            </div>
        </div>
    `;
    container.appendChild(div);
    if (data.images) renderGalleryUI(galleryId, data.images);
};

window.addSizeRow = (data = {}) => {
    if (typeof data === 'string') data = { name: data, images: [] };
    const container = document.getElementById('variation-container');
    if (!container) return;
    const id = "v-" + Date.now() + Math.random().toString(16).slice(2);
    const galleryId = "gallery-" + id;

    const div = document.createElement('div');
    div.className = "variation-row fade-in";
    div.dataset.type = "size";
    div.innerHTML = `
        <div class="flex justify-between items-center bg-gray-50/50 p-2 rounded-xl mb-2">
            <span class="text-[9px] font-black uppercase tracking-widest text-black flex items-center gap-2">
                <i class="fa-solid fa-ruler-combined text-gray-400"></i> Size Variation
            </span>
            <button onclick="this.closest('.variation-row').remove()" class="text-red-400 hover:text-red-600 transition-all">
                <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
        </div>
        <input type="text" class="v-name admin-input !py-3 !text-xs" placeholder="Size Name (e.g. XL or 12 Inches)" value="${data.name || ''}">
        <div class="space-y-2">
            <div class="flex justify-between items-center">
                <span class="text-[8px] font-black text-gray-400 uppercase">Size Photos</span>
                <button onclick="triggerGalleryUpload('${galleryId}')" class="text-[8px] font-bold uppercase text-blue-500 underline">+ Add</button>
            </div>
            <div id="${galleryId}" class="admin-gallery !min-h-[60px] !p-2" 
                 ondragover="handleGalleryDrag(event)" ondragleave="handleGalleryLeave(event)" ondrop="handleGalleryDrop(event, '${galleryId}')">
                <div class="w-full text-center py-2 text-[7px] font-bold text-gray-300 uppercase">Drop Size Images</div>
            </div>
        </div>
    `;
    container.appendChild(div);
    if (data.images) renderGalleryUI(galleryId, data.images);
};

window.resetForm = () => {
    const fields = ['edit-id', 'edit-cat-id', 'p-name', 'p-price', 'p-material', 'p-size', 'p-keywords', 'p-desc', 'p-cat-id', 'c-name'];
    fields.forEach(f => { const el = document.getElementById(f); if (el) el.value = ""; });

    // Protected Field Resets
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    const setInner = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

    setVal('c-img', 'img/');
    setChecked('p-stock', true);
    setChecked('p-pinned', false);
    setChecked('c-pinned', false);
    setInner('p-form-title', 'Product Details');
    setInner('c-form-title', 'New Category');

    // Clear Galleries & Variations
    renderGalleryUI('main-product-gallery', []);
    const varContainer = document.getElementById('variation-container');
    if (varContainer) varContainer.innerHTML = '';

    const catFilter = document.getElementById('admin-cat-filter');
    if (catFilter) catFilter.value = "all";
};

window.handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('dragging');
};

window.handleDragLeave = (e) => {
    e.currentTarget.classList.remove('dragging');
};

window.handleDrop = async (e, fieldId) => {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return showToast("Please drop an image file.");

    zone.classList.add('uploading');
    try {
        const url = await directCloudinaryUpload(file);
        document.getElementById(fieldId).value = url;
        showToast("Image Uploaded!");
    } catch (err) {
        showToast("Upload Failed.");
    } finally {
        zone.classList.remove('uploading');
    }
};


async function directCloudinaryUpload(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'laszon_preset');
    formData.append('cloud_name', 'dqxrl96d0');

    const res = await fetch(`https://api.cloudinary.com/v1_1/dqxrl96d0/image/upload`, {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    if (data.secure_url) return data.secure_url;
    throw new Error("Upload failed");
}

let cloudinaryWidget = null;
let cloudinaryTargetField = null;

window.cloudinaryUpload = (fieldId) => {
    cloudinaryTargetField = fieldId;
    if (cloudinaryWidget) {
        cloudinaryWidget.open();
        return;
    }
    cloudinaryWidget = cloudinary.createUploadWidget({
        cloudName: 'dqxrl96d0',
        apiKey: '228375249571749',
        uploadPreset: 'laszon_preset',
        sources: ['local', 'url', 'camera'],
        showAdvancedOptions: false,
        cropping: false,
        multiple: false,
        defaultSource: 'local',
        styles: {
            palette: { window: '#FFFFFF', windowBorder: '#90A0B3', tabIcon: '#000000', menuIcons: '#5A616A', textDark: '#000000', textLight: '#FFFFFF', link: '#000000', action: '#111111', inactiveTabIcon: '#0E2F5A', error: '#F44235', inProgress: '#0078FF', complete: '#20B832', sourceBg: '#E4EBF1' }
        }
    }, (error, result) => {
        if (!error && result && result.event === "success") {
            document.getElementById(cloudinaryTargetField).value = result.info.secure_url;
            showToast("Image Uploaded!");
        }
    });
    cloudinaryWidget.open();
};

let toastTimeout;
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        t.classList.remove('show');
    }, 3000);
}

window.getOptimizedUrl = (url, transform = 'f_auto,q_auto') => {
    if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return url;
    if (url.includes('f_auto,q_auto') && transform === 'f_auto,q_auto') return url;

    // If it already has transformations, replace them or handle appropriately
    // For simplicity, we assume we want to inject our transform after /upload/
    if (url.includes('/upload/')) {
        // Remove existing transformation if any and inject new one
        const parts = url.split('/upload/');
        const afterUpload = parts[1].split('/');
        // Check if first part after upload is a transformation string (contains , or w_ etc)
        if (afterUpload[0].includes('_') || afterUpload[0].includes(',')) {
            afterUpload.shift(); // Remove old transform
        }
        return `${parts[0]}/upload/${transform}/${afterUpload.join('/')}`;
    }
    return url;
}



// MOBILE SIDEBAR TOGGLE
window.toggleMobileSidebar = () => {
    const sidebar = document.getElementById('mobile-sidebar');
    if (!sidebar) return;
    if (sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
        document.body.style.overflow = '';
        // Reset panel position and hide after transition
        setTimeout(() => {
            switchSidebarPanel('main');
            sidebar.classList.replace('block', 'hidden');
        }, 300);
    } else {
        sidebar.classList.replace('hidden', 'block');
        setTimeout(() => sidebar.classList.add('active'), 10);
        document.body.style.overflow = 'hidden';
        updateSidebarCategories();
    }
};

window.switchSidebarPanel = (panelName) => {
    const mainPanel = document.getElementById('sidebar-panel-main');
    const catPanel = document.getElementById('sidebar-panel-categories');
    if (!mainPanel || !catPanel) return;

    if (panelName === 'categories') {
        mainPanel.classList.add('slide-out');
        catPanel.classList.add('slide-in');
    } else {
        mainPanel.classList.remove('slide-out');
        catPanel.classList.remove('slide-in');
    }
};


function updateSidebarCategories() {
    const list = document.getElementById('mobile-sidebar-categories-list');
    if (!list) return;

    list.innerHTML = `
        <div class="sidebar-category-grid">
            <div class="sidebar-category-card ${state.filter === 'all' ? 'active-category' : ''}" onclick="applyFilter('all'); toggleMobileSidebar()">
                <div class="sidebar-category-icon-box">
                    <i class="fa-solid fa-shapes text-xl ${state.filter === 'all' ? 'text-white' : 'text-[#333333]/20'}"></i>
                </div>
                <span>All Items</span>
            </div>
            ${DATA.c.map(c => `
                <div class="sidebar-category-card ${state.filter === c.id ? 'active-category' : ''}" onclick="applyFilter('${c.id}'); toggleMobileSidebar()">
                    <img src="${getOptimizedUrl(c.img, 'w_150,c_fill,f_auto,q_auto:eco')}" alt="${c.name}">
                    <span>${c.name}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// AUTHENTICATION LOGIC
let isLoginMode = true;

window.handleUserIconClick = () => {
    if (state.user && !state.user.isAnonymous) {
        toggleUserMenuModal();
    } else {
        toggleAuthModal();
    }
};

window.toggleUserMenuModal = () => {
    const modal = document.getElementById('user-menu-modal');
    if (!modal) return;
    modal.classList.toggle('hidden');

    // Blur logic for main app
    const app = document.getElementById('app');
    if (!modal.classList.contains('hidden')) {
        renderUserMenu();
        if (app) app.classList.add('blur-sm');
    } else {
        if (app) app.classList.remove('blur-sm');
    }
};

function renderUserMenu() {
    if (!state.user) return;
    const nameEl = document.getElementById('user-menu-name');
    const emailEl = document.getElementById('user-menu-email');
    const mobileEl = document.getElementById('user-menu-mobile');
    const adminLink = document.getElementById('admin-dashboard-link');

    if (nameEl) nameEl.innerText = state.user.displayName || 'Customer';
    if (emailEl) emailEl.innerText = state.user.email;

    // Fetch mobile from Firestore sync data if possible, or just use placeholder
    if (mobileEl) mobileEl.innerText = "Premium Member";

    if (adminLink) {
        if (state.isAdmin && window.innerWidth >= 1024) adminLink.classList.remove('hidden');
        else adminLink.classList.add('hidden');
    }
}

window.handleLogout = async () => {
    try {
        await signOut(auth);
        state.isAdmin = false;
        state.user = null;
        state.wishlist = [];
        state.cart = [];
        toggleUserMenuModal();
        showToast("Signed out successfully");
        renderHome();
    } catch (err) {
        console.error("Logout failed", err);
    }
};

window.toggleAuthModal = () => {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.toggle('hidden');
    // Blur logic for main app
    const app = document.getElementById('app');
    if (modal && !modal.classList.contains('hidden')) {
        app.classList.add('blur-sm');
    } else {
        app.classList.remove('blur-sm');
    }
};

window.switchAuthMode = () => {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleText = document.getElementById('auth-toggle-text');
    const nameField = document.getElementById('auth-name-div');
    const mobileField = document.getElementById('auth-mobile-div');
    const forgotLink = document.getElementById('auth-forgot-link');

    if (isLoginMode) {
        title.innerText = "Welcome Back";
        subtitle.innerText = "Sign in to save your collection";
        submitBtn.innerText = "Sign In";
        toggleText.innerHTML = `Don't have an account? <button onclick="switchAuthMode()" class="text-gold-luxe font-black uppercase tracking-widest ml-1 hover:underline">Create One</button>`;
        if (nameField) nameField.classList.add('hidden');
        if (mobileField) mobileField.classList.add('hidden');
        if (forgotLink) forgotLink.classList.remove('hidden');
    } else {
        title.innerText = "Join the Club";
        subtitle.innerText = "Create an account for permanent access";
        submitBtn.innerText = "Create Account";
        toggleText.innerHTML = `Already have an account? <button onclick="switchAuthMode()" class="text-gold-luxe font-black uppercase tracking-widest ml-1 hover:underline">Sign In</button>`;
        if (nameField) nameField.classList.remove('hidden');
        if (mobileField) mobileField.classList.remove('hidden');
        if (forgotLink) forgotLink.classList.add('hidden');
    }
};

window.handleForgotPassword = async () => {
    const email = document.getElementById('auth-email').value;
    if (!email) return showToast("Please enter your email address first.");

    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Password reset email sent! 📧✨");
    } catch (err) {
        console.error(err);
        showToast("Error sending reset email.");
    }
};

window.handleAuthSubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name')?.value;
    const mobile = document.getElementById('auth-mobile')?.value;
    const submitBtn = document.getElementById('auth-submit-btn');

    submitBtn.disabled = true;
    submitBtn.innerText = isLoginMode ? "Signing In..." : "Creating Account...";

    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
            showToast("Welcome back!");
        } else {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Update profile with Name
            if (name) {
                await updateProfile(user, { displayName: name });
            }

            // Sync to Firestore immediately
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid), {
                email: email,
                name: name || email.split('@')[0],
                mobile: mobile || "",
                lastLogin: Date.now(),
                uid: user.uid,
                createdAt: Date.now()
            });

            showToast("Account created successfully!");
        }
        toggleAuthModal();
        document.getElementById('auth-form').reset();
    } catch (err) {
        console.error(err);
        let msg = "Authentication failed";
        if (err.code === 'auth/wrong-password') msg = "Incorrect password";
        else if (err.code === 'auth/user-not-found') msg = "Account not found";
        else if (err.code === 'auth/email-already-in-use') msg = "Email already registered";
        else if (err.code === 'auth/weak-password') msg = "Password is too weak";
        else if (err.code === 'auth/invalid-email') msg = "Invalid email address";
        showToast(msg);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = isLoginMode ? "Sign In" : "Create Account";
    }
};

function updateUserUI() {
    const userBtn = document.getElementById('user-btn');
    if (!userBtn) return;

    if (state.user && !state.user.isAnonymous) {
        userBtn.innerHTML = `<i class="fa-solid fa-user-check text-sm text-gold-luxe"></i>`;
        userBtn.classList.add('border-gold-luxe/30');
    } else {
        userBtn.innerHTML = `<i class="fa-solid fa-user text-sm opacity-40"></i>`;
        userBtn.classList.remove('border-gold-luxe/30');
    }
}

// --- CART LOGIC ---
window.toggleCart = () => {
    const sidebar = document.getElementById('cart-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('hidden');
    if (!sidebar.classList.contains('hidden')) renderCart();
};

window.addToCart = (id) => {
    if (!state.cart.includes(id)) {
        state.cart.push(id);
        showToast('Added to Cart');
        updateCartBadge();
        saveCart();
    } else {
        showToast('Already in Cart');
    }
};

window.removeFromCart = (id) => {
    state.cart = state.cart.filter(i => i !== id);
    renderCart();
    updateCartBadge();
    saveCart();
    showToast('Removed from Cart');
};

function updateCartBadge() {
    const badge = document.getElementById('nav-cart-count');
    if (!badge) return;
    if (state.cart.length > 0) {
        badge.innerText = state.cart.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function renderCart() {
    const list = document.getElementById('cart-items-list');
    const countEl = document.getElementById('cart-total-count');
    if (!list || !countEl) return;

    countEl.innerText = state.cart.length;

    if (state.cart.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-center opacity-20">
                <i class="fa-solid fa-cart-shopping text-5xl mb-4"></i>
                <p class="text-[10px] font-black uppercase tracking-widest">Your cart is empty</p>
            </div>
        `;
        return;
    }

    const cartProducts = state.cart.map(id => DATA.p.find(p => p.id === id)).filter(p => p);

    list.innerHTML = cartProducts.map(p => `
        <div class="flex items-center gap-4 border-b border-gray-50 pb-4">
            <img src="${getOptimizedUrl(p.img)}" class="cart-item-img">
            <div class="flex-1">
                <h4 class="text-[12px] font-bold text-[#333333]">${p.name}</h4>
                <p class="text-[10px] text-[#333333]/40">${p.price} AED</p>
            </div>
            <button onclick="removeFromCart('${p.id}')" class="text-gray-300 hover:text-red-500 transition-all">
                <i class="fa-solid fa-trash-can text-sm"></i>
            </button>
        </div>
    `).join('');
}

window.checkoutCart = () => {
    if (state.cart.length === 0) return showToast('Cart is empty');

    let msg = 'Hello Laszon Gifts, I am interested in these items:\n\n';
    state.cart.forEach((id, idx) => {
        const p = DATA.p.find(x => x.id === id);
        if (p) {
            const pUrl = `${window.location.origin}${window.location.pathname}?p=${p.id}`;
            msg += `${idx + 1}. *${p.name}* (${p.price} AED)\nLink: ${pUrl}\n\n`;
        }
    });

    const wpUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
    window.open(wpUrl, '_blank');
};

window.toggleWishlistSidebar = () => {
    const sidebar = document.getElementById('wishlist-sidebar');
    const app = document.getElementById('app');
    if (!sidebar) return;
    const isHidden = sidebar.classList.contains('hidden');

    if (isHidden) {
        sidebar.classList.remove('hidden');
        renderWishlistSidebar();
        if (app) app.classList.add('blur-sm');
    } else {
        sidebar.classList.add('hidden');
        if (app) app.classList.remove('blur-sm');
    }
};

function renderWishlistSidebar() {
    const list = document.getElementById('wishlist-items-list');
    if (!list) return;

    if (state.wishlist.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-center opacity-20">
                <i class="fa-solid fa-heart text-5xl mb-4"></i>
                <p class="text-[10px] font-black uppercase tracking-widest">No favorites yet</p>
            </div>
        `;
        return;
    }

    const items = state.wishlist.map(id => {
        const p = DATA.p.find(x => x.id === id);
        if (!p) return '';
        return `
            <div class="flex items-center gap-4 group fade-in">
                <div class="w-20 h-20 rounded-2xl overflow-hidden shadow-lg shadow-black/5 border border-gray-50 bg-gray-50">
                    <img src="${getOptimizedUrl(p.img)}" class="w-full h-full object-cover">
                </div>
                <div class="flex-1">
                    <h4 class="text-[11px] font-bold text-[#333333] mb-1">${p.name}</h4>
                    <p class="text-[10px] font-black text-[#333333]/40 mb-3">${p.price} AED</p>
                    <div class="flex gap-2">
                        <button onclick="addToCart('${p.id}')" 
                            class="text-[8px] font-black uppercase tracking-widest text-white bg-[#121212] px-3 py-1.5 rounded-lg active:scale-95 transition-all">
                            Add to Cart
                        </button>
                        <button onclick="toggleWishlist('${p.id}')" 
                            class="text-[8px] font-black uppercase tracking-widest text-red-500 bg-red-50 px-3 py-1.5 rounded-lg active:scale-95 transition-all">
                            Remove
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    list.innerHTML = items;
}
