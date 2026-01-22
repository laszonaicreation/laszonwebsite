import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, doc, deleteDoc, updateDoc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyD9YVfGZdSNesw26IsmfFaTBExlYoGt0gc",
    authDomain: "laszon-uae-catalogue.firebaseapp.com",
    projectId: "laszon-uae-catalogue",
    storageBucket: "laszon-uae-catalogue.firebasestorage.app",
    messagingSenderId: "1070868763766",
    appId: "1:1070868763766:web:e5d9525b0baccb2eb3fb57"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = firebaseConfig.projectId;

const prodCol = collection(db, 'artifacts', appId, 'public', 'data', 'products');
const catCol = collection(db, 'artifacts', appId, 'public', 'data', 'categories');
const shareCol = collection(db, 'artifacts', appId, 'public', 'data', 'selections');
const bannerCol = collection(db, 'artifacts', appId, 'public', 'data', 'banners');
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

let state = { filter: 'all', sort: 'all', search: '', user: null, selected: [], wishlist: [], cart: [], selectionId: null, scrollPos: 0, banners: [], settings: { storeName: 'LASZON GIFTS', logo: '' } };
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

        // Merge anonymous wishlist to permanent account
        if (wasAnonymous && !u.isAnonymous && anonWishlist.length > 0) {
            state.wishlist = Array.from(new Set([...state.wishlist, ...anonWishlist]));
            await setDoc(doc(db, 'artifacts', appId, 'users', u.uid, 'data', 'wishlist'), { ids: state.wishlist });
            showToast("Syncing your favorites...");
        }

        refreshData();
        renderHome(); // Initial "fast" render
        updateUserUI();
    } else {
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
        const wishDoc = await getDoc(doc(db, 'artifacts', appId, 'users', state.user.uid, 'data', 'wishlist'));
        if (wishDoc.exists()) {
            state.wishlist = wishDoc.data().ids || [];
            updateWishlistBadge();
        }
    } catch (err) { console.error("Wishlist Load Error"); }
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
        await setDoc(doc(db, 'artifacts', appId, 'users', state.user.uid, 'data', 'wishlist'), { ids: state.wishlist });
    } catch (err) { console.error("Sync Error", err); }
};

async function refreshData(isNavigationOnly = false) {
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
        const isAdminOpen = !document.getElementById('admin-panel').classList.contains('hidden');

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
        const iconsToLoad = DATA.c.map(c => getOptimizedUrl(c.img)).filter(u => u && u !== 'img/').slice(0, 10);
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

        const prodsToLoad = filteredForPreload.slice(0, 8).map(p => getOptimizedUrl(p.img)).filter(u => u && u !== 'img/');
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
    const now = Date.now();
    if (now - lastClickTime > 5000) clicks = 0;
    clicks++; lastClickTime = now;
    if (clicks >= 5) {
        const btn = document.getElementById('admin-entry-btn');
        const hideBtn = document.getElementById('admin-hide-btn');
        if (btn) {
            btn.classList.remove('hidden');
            if (hideBtn) hideBtn.classList.remove('hidden');
            showToast("Dashboard Unlocked");
            renderHome(); // Re-render to show pin icons
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

function renderHome() {
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
                <img src="${getOptimizedUrl(c.img, 'w_200,c_fill,f_auto,q_auto')}" alt="${c.name}" class="w-full h-full object-cover" loading="lazy">
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
                            <img src="${getOptimizedUrl(p.img, 'w_600,c_fill,f_auto,q_auto')}" 
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

    const thumbs = [p.img, p.img2, p.img3].filter(u => u && u !== 'img/').map(imgUrl => `
        <div class="thumb-box ${imgUrl === p.img ? 'active' : ''}" onclick="switchImg('${imgUrl}', this)">
            <img src="${getOptimizedUrl(imgUrl)}">
        </div>
    `).join('');

    dynamicContent.innerHTML = `
        <div class="detail-view-container fade-in pt-4 pb-32">
            <div class="max-w-4xl mx-auto px-6">
                <!-- ELEGANT BACK BUTTON -->
                <button onclick="goBackToHome()" class="mb-8 flex items-center gap-2 text-[#333333]/40 hover:text-[#333333] transition-all group">
                    <div class="w-8 h-8 rounded-full border border-black/10 flex items-center justify-center group-hover:bg-black/5 transition-all">
                        <i class="fa-solid fa-arrow-left text-xs"></i>
                    </div>
                    <span class="text-[9px] font-black uppercase tracking-[0.2em]">Back to Gallery</span>
                </button>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-20">
                    <div class="space-y-6">
                        <div class="zoom-img-container shadow-2xl shadow-black/5 border-none rounded-[2.5rem]" 
                             onmousemove="handleZoom(event, this)" 
                             onmouseleave="resetZoom(this)"
                             onclick="openFullScreen('${p.img}')">
                            <img id="main-detail-img" src="${p.img}" alt="${p.name}">
                        </div>
                        <div class="thumb-grid no-scrollbar overflow-x-auto pb-4">
                            ${thumbs}
                        </div>
                    </div>
                    <div class="space-y-8 pt-4">
                        <div class="space-y-3">
                            <span class="luxe-tag text-[10px] text-gold-luxe">Laszon Exclusive Selection</span>
                            <h2 class="detail-product-name leading-tight text-[#333333]">${p.name}</h2>
                            <p class="text-xl font-bold text-[#333333]/60">${p.price} AED</p>
                        </div>
                        
                        <div class="flex flex-col gap-4">
                            <!-- WhatsApp HIGHLIGHTED AS PRIMARY -->
                            <button onclick="inquireOnWhatsApp('${p.id}')" 
                                class="w-full bg-[#121212] text-white py-6 rounded-2xl font-black text-[11px] uppercase tracking-[0.25em] shadow-2xl shadow-black/30 active:scale-95 transition-all flex items-center justify-center gap-3">
                                <i class="fa-brands fa-whatsapp text-2xl"></i> WhatsApp Inquiry
                            </button>

                            <div class="flex gap-4">
                                <button onclick="addToCart('${p.id}')" 
                                    class="flex-[4] glass-panel text-[#333333] py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] active:scale-95 transition-all flex items-center justify-center gap-3 border border-black/10">
                                    <i class="fa-solid fa-cart-shopping text-lg"></i> Add to Cart
                                </button>
                                <button onclick="toggleWishlist('${p.id}')" 
                                    class="flex-1 glass-panel text-[#333333] rounded-2xl flex items-center justify-center active:scale-90 transition-all border border-black/10">
                                    <i class="fa-${state.wishlist.includes(p.id) ? 'solid' : 'regular'} fa-heart text-xl ${state.wishlist.includes(p.id) ? 'text-red-500' : ''}"></i>
                                </button>
                            </div>
                        </div>

                        ${p.inStock === false ? '<div class="p-4 bg-red-50 text-red-600 rounded-xl text-center font-black text-[10px] uppercase tracking-widest border border-red-100 italic">This product is currently sold out.</div>' : ''}

                        <div class="space-y-8 pt-10 border-t border-gray-100">
                             <div class="grid grid-cols-1 gap-6">
                                 ${p.size ? `<div><span class="detail-label">Dimensions</span><p class="text-[13px] font-bold text-[#333333]">${p.size}</p></div>` : ''}
                                 ${p.material ? `<div><span class="detail-label">Material & Craftsmanship</span><p class="text-[13px] font-bold text-[#333333]">${p.material}</p></div>` : ''}
                             </div>
                            <div>
                                <span class="detail-label">The Story</span>
                                <p class="detail-description-text leading-relaxed">${p.desc || "An exquisite piece carefully curated for the Laszon collection. Crafted with exceptional attention to detail."}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.saveProduct = async () => {
    const id = document.getElementById('edit-id')?.value;
    const btn = document.getElementById('p-save-btn');
    const data = {
        name: document.getElementById('p-name')?.value,
        price: document.getElementById('p-price')?.value,
        size: document.getElementById('p-size')?.value,
        material: document.getElementById('p-material')?.value,
        inStock: document.getElementById('p-stock')?.checked,
        img: document.getElementById('p-img')?.value,
        img2: document.getElementById('p-img2')?.value,
        img3: document.getElementById('p-img3')?.value,
        catId: document.getElementById('p-cat-id')?.value,
        desc: document.getElementById('p-desc')?.value,
        keywords: document.getElementById('p-keywords')?.value,
        isPinned: document.getElementById('p-pinned')?.checked || false,
        updatedAt: Date.now()
    };
    if (!data.name || !data.img) return showToast("Required info missing");
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
    const item = DATA.p.find(x => x.id === id);
    if (!item) return;
    const editId = document.getElementById('edit-id');
    const pName = document.getElementById('p-name');
    const pPrice = document.getElementById('p-price');
    const pSize = document.getElementById('p-size');
    const pMaterial = document.getElementById('p-material');
    const pStock = document.getElementById('p-stock');
    const pPinned = document.getElementById('p-pinned');
    const pImg = document.getElementById('p-img');
    const pImg2 = document.getElementById('p-img2');
    const pImg3 = document.getElementById('p-img3');
    const pCatId = document.getElementById('p-cat-id');
    const pDesc = document.getElementById('p-desc');
    const pKeywords = document.getElementById('p-keywords');
    const pFormTitle = document.getElementById('p-form-title');

    if (editId) editId.value = item.id;
    if (pName) pName.value = item.name;
    if (pPrice) pPrice.value = item.price;
    if (pSize) pSize.value = item.size || "";
    if (pMaterial) pMaterial.value = item.material || "";
    if (pStock) pStock.checked = item.inStock !== false;
    if (pPinned) pPinned.checked = item.isPinned || false;
    if (pImg) pImg.value = item.img || "img/";
    if (pImg2) pImg2.value = item.img2 || "img/";
    if (pImg3) pImg3.value = item.img3 || "img/";
    if (pCatId) pCatId.value = item.catId || "";

    if (pDesc) pDesc.value = item.desc;
    if (pKeywords) pKeywords.value = item.keywords || "";
    if (pFormTitle) pFormTitle.innerText = "Editing: " + item.name;
    switchAdminTab('products');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    switchAdminTab('categories');
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
    if (!confirm("This will add items from backup to current project. Continue?")) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            showToast("Restoring... Please Wait");

            // 1. Map old IDs to Names from the backup file
            const catOldIdToName = {};
            if (data.categories) {
                data.categories.forEach(c => { if (c.id) catOldIdToName[c.id] = (c.name || "").trim(); });
            }

            // 2. Handle/Create Categories & Build Name to New ID Map
            if (data.categories) {
                for (const cat of data.categories) {
                    const trimmedName = (cat.name || "").trim();
                    const exists = DATA.c.find(c => c.name.trim() === trimmedName);
                    if (!exists) {
                        const cleanCat = { name: trimmedName, img: cat.img || cat.iconUrl || "img/" };
                        const newDoc = await addDoc(catCol, cleanCat);
                        // Add to a temp list so we can map right away
                        DATA.c.push({ id: newDoc.id, ...cleanCat });
                    }
                }
            }

            // Build the final mapping: Trimmed Name -> Current/New ID
            const nameToNewId = {};
            DATA.c.forEach(c => { nameToNewId[c.name.trim()] = c.id; });

            // 3. Handle Products
            if (data.products) {
                for (const p of data.products) {
                    // Find the NEW Category ID
                    let finalCatId = "";
                    const oldCatName = catOldIdToName[p.catId];
                    if (oldCatName && nameToNewId[oldCatName]) {
                        finalCatId = nameToNewId[oldCatName];
                    } else if (p.catId && nameToNewId[p.catId]) {
                        // Fallback if catId in backup was already a name or matches exactly
                        finalCatId = nameToNewId[p.catId];
                    }

                    const pImg = (p.images && p.images[0]) || p.img || "img/";

                    // Refined Duplicate Check (Name + Category + Primary Image)
                    const isDuplicate = DATA.p.some(ep =>
                        ep.name === p.name &&
                        ep.catId === finalCatId &&
                        (ep.img === pImg)
                    );
                    if (isDuplicate) continue;

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

                    await addDoc(prodCol, cleanProd);
                }
            }
            showToast("Restore Successful!");
            refreshData();
        } catch (err) {
            console.error(err);
            showToast("Import Failed");
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
    window.open(`https://wa.me/971559653589?text=${encodeURIComponent(msg)}`);
};

window.inquireOnWhatsApp = (id) => {
    const p = DATA.p.find(x => x.id === id);
    if (!p) return;
    const pUrl = `${window.location.origin}${window.location.pathname}?p=${p.id}`;
    const msg = `*Inquiry regarding:* ${p.name}\n*Price:* ${p.price} AED\n\n*Product Link:* ${pUrl}\n\nPlease let me know the availability.`;
    window.open(`https://wa.me/971559653589?text=${encodeURIComponent(msg)}`);
};

window.switchImg = (src, el) => {
    const main = document.getElementById('main-detail-img');
    if (main) {
        main.src = getOptimizedUrl(src);
        // Update click handler for full-screen preview
        main.closest('.zoom-img-container')?.setAttribute('onclick', `openFullScreen('${src}')`);
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
    const tabs = ['p', 'c', 'b', 's'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const sectionId = t === 'p' ? 'admin-product-section' : t === 'c' ? 'admin-category-section' : t === 'b' ? 'admin-banner-section' : 'admin-settings-section';
        const listId = t === 'p' ? 'admin-product-list-container' : t === 'c' ? 'admin-category-list' : t === 'b' ? 'admin-banner-list' : null;

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

    const demoBtn = document.getElementById('add-demo-banner-btn');
    if (demoBtn) demoBtn.classList.toggle('hidden', tab !== 'b');

    renderAdminUI();
};

window.editProduct = (id) => {
    const item = DATA.p.find(x => x.id === id);
    if (!item) return;
    switchAdminTab('p');
    document.getElementById('edit-id').value = item.id;
    document.getElementById('p-name').value = item.name;
    document.getElementById('p-price').value = item.price;
    document.getElementById('p-cat-id').value = item.catId;
    document.getElementById('p-size').value = item.size || '';
    document.getElementById('p-material').value = item.material || '';
    document.getElementById('p-desc').value = item.desc || '';
    document.getElementById('p-img').value = item.img || 'img/';
    document.getElementById('p-img2').value = item.img2 || 'img/';
    document.getElementById('p-img3').value = item.img3 || 'img/';
    document.getElementById('p-stock').checked = item.inStock !== false;
    document.getElementById('p-pinned').checked = item.isPinned === true;
    document.getElementById('p-keywords').value = item.keywords || '';
    document.getElementById('p-form-title').innerText = "Edit Product";
    document.getElementById('p-save-btn').innerText = "Update Product";
    document.getElementById('admin-panel').scrollTo({ top: 0, behavior: 'smooth' });
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
                <img src="https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=1000&auto=format&fit=crop" class="absolute inset-0 w-full h-full object-cover">
                <div class="absolute inset-0 bg-gradient-to-r from-[#8b6c31]/70 via-[#8b6c31]/20 to-transparent flex flex-col justify-center px-8 md:px-16">
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
            <img src="${getOptimizedUrl(b.img)}" class="absolute inset-0 w-full h-full object-cover brightness-90">
            <div class="absolute inset-0 bg-gradient-to-r from-[#8b6c31]/60 via-[#8b6c31]/10 to-transparent flex flex-col justify-center px-8 md:px-16">
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

window.resetForm = () => {
    const fields = ['edit-id', 'edit-cat-id', 'p-name', 'p-price', 'p-size', 'p-material', 'p-desc', 'p-keywords', 'c-name'];
    fields.forEach(f => { const el = document.getElementById(f); if (el) el.value = ""; });
    document.getElementById('p-img').value = "img/"; document.getElementById('p-img2').value = "img/"; document.getElementById('p-img3').value = "img/";
    document.getElementById('c-img').value = "img/";
    document.getElementById('p-stock').checked = true;
    document.getElementById('p-pinned').checked = false;
    document.getElementById('c-pinned').checked = false;
    document.getElementById('p-form-title').innerText = "Product Details";
    document.getElementById('c-form-title').innerText = "New Category";

    if (document.getElementById('admin-cat-filter')) document.getElementById('admin-cat-filter').value = "all";
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

function showToast(msg) {
    const t = document.getElementById('toast'); if (!t) return;
    t.innerText = msg; t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
}

function getOptimizedUrl(url, transform = 'f_auto,q_auto') {
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

startSync();

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
    const container = document.getElementById('mobile-sidebar-categories-list');
    if (!container) return;

    container.innerHTML = DATA.c.map(c => `
        <a href="#" onclick="applyFilter('${c.id}'); toggleMobileSidebar()" class="sidebar-nav-link">
            <span class="w-2 h-2 rounded-full bg-[#121212]/10"></span> ${c.name}
        </a>
    `).join('');
}

// AUTHENTICATION LOGIC
let isLoginMode = true;

window.handleUserIconClick = () => {
    if (state.user && !state.user.isAnonymous) {
        showAdminPanel();
    } else {
        toggleAuthModal();
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

    if (isLoginMode) {
        title.innerText = "Welcome Back";
        subtitle.innerText = "Sign in to save your collection";
        submitBtn.innerText = "Sign In";
        toggleText.innerHTML = `Don't have an account? <button onclick="switchAuthMode()" class="text-gold-luxe font-black uppercase tracking-widest ml-1 hover:underline">Create One</button>`;
    } else {
        title.innerText = "Join the Club";
        subtitle.innerText = "Create an account for permanent access";
        submitBtn.innerText = "Create Account";
        toggleText.innerHTML = `Already have an account? <button onclick="switchAuthMode()" class="text-gold-luxe font-black uppercase tracking-widest ml-1 hover:underline">Sign In</button>`;
    }
};

window.handleAuthSubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit-btn');

    submitBtn.disabled = true;
    submitBtn.innerText = isLoginMode ? "Signing In..." : "Creating Account...";

    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
            showToast("Welcome back!");
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
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
    } else {
        showToast('Already in Cart');
    }
};

window.removeFromCart = (id) => {
    state.cart = state.cart.filter(i => i !== id);
    renderCart();
    updateCartBadge();
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
            msg += (idx + 1) + '. ' + p.name + ' (' + p.price + ' AED)\n';
        }
    });

    const wpUrl = `https://wa.me/971524317929?text=${encodeURIComponent(msg)}`;
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
