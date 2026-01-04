import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, doc, deleteDoc, updateDoc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAggNtKyGHlnjhx8vwbZFL5aM98awBt6Sw",
    authDomain: "speed-catalogue.firebaseapp.com",
    projectId: "speed-catalogue",
    storageBucket: "speed-catalogue.firebasestorage.app",
    messagingSenderId: "84589409246",
    appId: "1:84589409246:web:124e25b09ba54dc9e3e34f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = firebaseConfig.projectId;

const prodCol = collection(db, 'artifacts', appId, 'public', 'data', 'products');
const catCol = collection(db, 'artifacts', appId, 'public', 'data', 'categories');
const shareCol = collection(db, 'artifacts', appId, 'public', 'data', 'selections');

let DATA = { p: [], c: [] };
let state = { filter: 'all', sort: 'all', search: '', user: null, selected: [], wishlist: [], selectionId: null, scrollPos: 0 };
let clicks = 0, lastClickTime = 0;

const startSync = async () => {
    try { await signInAnonymously(auth); }
    catch (err) { console.error(err); }
};

onAuthStateChanged(auth, async (u) => {
    state.user = u;
    if (u) {
        await loadWishlist();
        refreshData();
    }
});

const handleReentry = () => {
    if (DATA.p.length > 0) {
        const urlParams = new URLSearchParams(window.location.search);
        const pId = urlParams.get('p');
        if (pId) viewDetail(pId, true);
        else renderHome();
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
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

// GLOBAL SAFETY: Hide loader no matter what after 4 seconds
setTimeout(() => {
    const loader = document.getElementById('loader');
    if (loader && loader.style.display !== 'none') {
        console.warn("Safety loader hide triggered.");
        loader.style.display = 'none';
    }
}, 4000);

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

window.toggleWishlist = async (e, id) => {
    e.stopPropagation();
    if (!state.user) return showToast("Authenticating...");
    const card = e.target.closest('.product-card');
    if (state.wishlist.includes(id)) {
        state.wishlist = state.wishlist.filter(x => x !== id);
        if (card) card.classList.remove('wish-active');
    } else {
        state.wishlist.push(id);
        if (card) card.classList.add('wish-active');
    }
    updateWishlistBadge();
    try {
        await setDoc(doc(db, 'artifacts', appId, 'users', state.user.uid, 'data', 'wishlist'), { ids: state.wishlist });
        if (state.filter === 'wishlist') renderHome();
    } catch (err) { showToast("Sync Error"); }
};

async function refreshData(isNavigationOnly = false) {
    try {
        if (!isNavigationOnly || DATA.p.length === 0) {
            const [pSnap, cSnap] = await Promise.all([getDocs(prodCol), getDocs(catCol)]);
            DATA.p = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            DATA.c = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        const urlParams = new URLSearchParams(window.location.search);
        const shareId = urlParams.get('s');
        const prodId = urlParams.get('p');
        const isAdminOpen = !document.getElementById('admin-panel').classList.contains('hidden');

        if (!isAdminOpen) {
            if (prodId && DATA.p.length > 0) {
                viewDetail(prodId, true);
            } else if (shareId) {
                try {
                    const selDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'selections', shareId));
                    if (selDoc.exists()) {
                        state.selectionId = shareId;
                        state.selected = selDoc.data().ids;
                    }
                } catch (e) { console.error("Selection sync failed"); }
                renderHome();
            } else {
                renderHome();
            }
        } else {
            renderHome();
        }

        populateCatSelect();
        populateAdminCatFilter();
        renderAdminUI();

        const loader = document.getElementById('loader');
        if (loader) {
            const urlParams = new URLSearchParams(window.location.search);
            const isDirectLink = urlParams.has('p') || urlParams.has('s');

            if (isDirectLink) {
                loader.style.display = 'none';
            } else {
                const safetyTimer = setTimeout(() => { loader.style.display = 'none'; }, 4000);

                // Priority 1: Category icons (Necessary for navigation)
                const iconsToLoad = DATA.c.map(c => c.img).filter(u => u && u !== 'img/').slice(0, 10);

                // Priority 2: Top products for current state (Accounting for current filters)
                const stockFilter = (items) => items.filter(p => p.inStock !== false);
                let filteredForPreload = [];
                if (state.selectionId) filteredForPreload = DATA.p.filter(p => state.selected.includes(p.id));
                else if (state.filter === 'wishlist') filteredForPreload = DATA.p.filter(p => state.wishlist.includes(p.id));
                else if (state.filter !== 'all') filteredForPreload = stockFilter(DATA.p.filter(p => p.catId === state.filter));
                else filteredForPreload = stockFilter(DATA.p);

                // Sort matching renderHome
                filteredForPreload.sort((a, b) => {
                    const pinA = a.isPinned ? 1 : 0;
                    const pinB = b.isPinned ? 1 : 0;
                    if (pinA !== pinB) return pinB - pinA;
                    if (a.isPinned && b.isPinned) {
                        return (a.pinnedAt || 0) - (b.pinnedAt || 0);
                    }
                    return (b.updatedAt || 0) - (a.updatedAt || 0);
                });

                const prodsToLoad = filteredForPreload.slice(0, 8).map(p => p.img).filter(u => u && u !== 'img/');
                const allToPreload = [...new Set([...prodsToLoad, ...iconsToLoad])];

                if (allToPreload.length > 0) {
                    // High priority preloading for the top products
                    await Promise.all(allToPreload.map(url => new Promise((resolve) => {
                        const img = new Image();
                        img.src = url;
                        img.onload = resolve;
                        img.onerror = resolve;
                        setTimeout(resolve, 800); // reduced timeout for faster opening
                    })));
                }
                clearTimeout(safetyTimer);
                loader.style.display = 'none';
            }
        }
    } catch (err) {
        console.error(err);
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
    }
}

const safePushState = (params, replace = false) => {
    try {
        const url = new URL(window.location.href);
        if (params.p === null) url.searchParams.delete('p');
        if (params.s === null) url.searchParams.delete('s');
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

window.hideDashboardButton = () => {
    const btn = document.getElementById('admin-entry-btn');
    const hideBtn = document.getElementById('admin-hide-btn');
    if (btn) btn.classList.add('hidden');
    if (hideBtn) hideBtn.classList.add('hidden');
    showToast("Dashboard Hidden");
    renderHome(); // Re-render to hide pin icons
};

window.goBackToHome = (forceReset = false) => {
    if (forceReset) {
        state.selectionId = null;
        state.selected = [];
        state.filter = 'all';
        state.scrollPos = 0;
        safePushState({ s: null, p: null });
    } else {
        safePushState({ p: null });
    }
    renderHome();
};

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
        if (!appMain.querySelector('#product-grid')) {
            appMain.innerHTML = template.innerHTML;
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

        // 1. Handle selection/wishlist headers
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
            const isAdminVisible = !document.getElementById('admin-entry-btn').classList.contains('hidden');

            let categories = [...DATA.c].sort((a, b) => {
                const pinA = a.isPinned ? 1 : 0;
                const pinB = b.isPinned ? 1 : 0;
                if (pinA !== pinB) return pinB - pinA;
                if (a.isPinned && b.isPinned) {
                    return (a.pinnedAt || 0) - (b.pinnedAt || 0);
                }
                return 0;
            });

            categories.forEach(c => {
                cHtml += `<div class="category-item ${state.filter === c.id ? 'active' : ''}" onclick="applyFilter('${c.id}', event)">
                    <div class="category-img-box">
                        <img src="${c.img}" onerror="this.src='https://placehold.co/100x100?text=Gift'">
                        ${c.isPinned && isAdminVisible ? '<div class="absolute -top-1 -right-1 w-4 h-4 bg-black text-white rounded-full flex items-center justify-center border-2 border-white shadow-sm"><i class="fa-solid fa-thumbtack text-[6px]"></i></div>' : ''}
                    </div>
                    <p class="category-label truncate px-1 w-full">${c.name}</p>
                </div>`;
            });
            if (catRow) {
                catRow.innerHTML = cHtml;

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
            grid.innerHTML = filtered.map((p, idx) => `
        <div class="product-card group fade-in ${state.selected.includes(p.id) ? 'selected' : ''} ${state.wishlist.includes(p.id) ? 'wish-active' : ''}" onclick="viewDetail('${p.id}')">
            <div class="wish-btn shadow-sm" onclick="toggleWishlist(event, '${p.id}')"><i class="fa-solid fa-heart text-[10px]"></i></div>
            ${!state.selectionId && !state.filter.includes('wishlist') ? `<div class="select-btn shadow-sm" onclick="toggleSelect(event, '${p.id}')"><i class="fa-solid fa-check text-[10px]"></i></div>` : ''}
            <div class="img-container mb-4 shadow-sm">
                <img src="${p.img}" 
                     ${idx < 8 ? 'fetchpriority="high" loading="eager"' : 'fetchpriority="low" loading="lazy"'}
                     decoding="async"
                     onload="this.classList.add('loaded')"
                     alt="${p.name}">
            </div>
            <div class="px-1 text-left">
                <h3 class="capitalize truncate leading-none text-gray-900 font-semibold">${p.name}</h3>
                <p class="price-tag mt-2 font-bold">${p.price} AED</p>
            </div>
        </div>
    `).join('') || `<p class="col-span-full text-center py-40 text-gray-300 italic text-[11px]">No items found.</p>`;
        }

        // 5. Update Search & Sort UI
        if (discSearch && discSearch !== document.activeElement) discSearch.value = state.search;
        if (clearBtn) {
            if (state.search) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
        if (mobileSort) mobileSort.value = state.sort;

        updateSelectionBar();
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
    if (!appMain) return;
    appMain.innerHTML = `
<div class="max-w-5xl mx-auto py-8 md:py-16 fade-in px-4 pb-64 detail-view-container text-left">
    <button onclick="goBackToHome()" class="mb-12 text-[10px] font-bold text-gray-400 flex items-center gap-2 uppercase tracking-widest hover:text-black transition-all">
        <i class="fa-solid fa-arrow-left"></i> Back to ${state.filter === 'wishlist' ? 'Favorites' : (state.selectionId ? 'Selection' : 'Catalogue')}
    </button>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">
        <div>
            <div class="zoom-img-container aspect-square" onmousemove="handleZoom(event, this)" onmouseleave="resetZoom(this)" onclick="openFullScreen('${p.img}')">
                <img src="${p.img}" id="main-detail-img" class="w-full h-full object-cover" fetchpriority="high" loading="eager">
            </div>
            <div class="thumb-grid justify-center lg:justify-start">
                <div class="thumb-box active" onclick="switchImg('${p.img}', this)"><img src="${p.img}"></div>
                ${p.img2 && p.img2 !== 'img/' ? `<div class="thumb-box" onclick="switchImg('${p.img2}', this)"><img src="${p.img2}"></div>` : ''}
                ${p.img3 && p.img3 !== 'img/' ? `<div class="thumb-box" onclick="switchImg('${p.img3}', this)"><img src="${p.img3}"></div>` : ''}
            </div>
        </div>
        <div class="py-2">
            <span class="text-[9px] font-bold text-gray-300 tracking-[0.05em] uppercase mb-8 block">Exclusive Selection</span>
            <div class="space-y-12">
                <div><span class="detail-label">Item name:</span><h2 class="detail-product-name capitalize">${p.name}</h2></div>
                <div class="flex items-center gap-10 mt-8 mb-10 pb-10 border-b border-gray-100">
                    <div><span class="detail-label">Listing Price</span><p class="detail-price-text">${p.price} AED</p></div>
                    <div class="h-10 w-px bg-gray-100"></div>
                    <div><span class="detail-label">Availability</span><p class="text-sm font-bold text-black flex items-center gap-2">
                        ${p.inStock !== false ? '<span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> In Stock' : '<span class="w-2 h-2 bg-red-500 rounded-full"></span> Out of Stock'}
                    </p></div>
                </div>
                <div class="flex flex-wrap gap-4 mb-12">
                    ${p.size ? `<div class="spec-badge"><i class="fa-solid fa-maximize text-[10px] text-gray-400"></i><span>${p.size}</span></div>` : ''}
                    ${p.material ? `<div class="spec-badge"><i class="fa-solid fa-layer-group text-[10px] text-gray-400"></i><span>${p.material}</span></div>` : ''}
                </div>
                <div class="mb-14">
                    <span class="detail-label">Product Story</span>
                    <p class="detail-description-text mt-4 whitespace-pre-line">${p.desc || 'Premium handcrafted selection curated specifically for our collection.'}</p>
                </div>
                <button onclick="inquireOnWhatsApp('${p.id}')" class="hidden md:flex w-full bg-black text-white py-6 rounded-3xl font-bold text-[11px] uppercase tracking-[0.2em] shadow-xl items-center justify-center gap-3 hover:scale-[1.02] transition-all">
                    <i class="fa-brands fa-whatsapp text-lg"></i>
                    INQUIRE ON WHATSAPP
                </button>
            </div>
        </div>
    </div>
</div>
<div class="fixed md:hidden bottom-0 left-0 w-full flex justify-center p-3 z-[70]">
    <div class="w-11/12 bg-white/80 backdrop-blur-xl border border-white/20 p-1.5 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.15)] premium-btn-anim">
        <button onclick="inquireOnWhatsApp('${p.id}')" class="w-full bg-black text-white py-3.5 rounded-full font-bold text-[10px] uppercase tracking-[0.15em] flex items-center justify-center gap-3 active:scale-95 transition-all">
            <i class="fa-brands fa-whatsapp text-lg text-green-400"></i>
            INQUIRE ON WHATSAPP
        </button>
    </div>
</div>
`;
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

window.deleteProduct = async (id) => { if (!confirm("Are you sure?")) return; try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', id)); showToast("Deleted"); refreshData(); } catch (e) { showToast("Delete Error"); } };
window.deleteCategory = async (id) => { if (!confirm("Delete Category?")) return; try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'categories', id)); showToast("Category Removed"); refreshData(); } catch (e) { showToast("Error"); } };

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
        a.download = `speedgifts_backup_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`;
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
        a.download = `speedgifts_inventory_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast("Excel Exported!");
    } catch (err) { showToast("Export Failed"); }
};

// NEW: UNIVERSAL MIGRATION LOGIC (FOR FUTURE DB SWITCHING)
window.copyUniversalJSON = () => {
    try {
        const universalBackup = {
            metadata: {
                source: "Speed Gifts Boutique UI",
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
    let msg = `*Hello Speed Gifts!*\nI am interested in these items:\n\n`;
    items.forEach((item, i) => { const pUrl = `${window.location.origin}${window.location.pathname}?p=${item.id}`; msg += `${i + 1}. *${item.name}* - ${item.price} AED\nLink: ${pUrl}\n\n`; });
    window.open(`https://wa.me/971561010387?text=${encodeURIComponent(msg)}`);
};

window.inquireOnWhatsApp = (id) => {
    const p = DATA.p.find(x => x.id === id);
    if (!p) return;
    const pUrl = `${window.location.origin}${window.location.pathname}?p=${p.id}`;
    const msg = `*Inquiry regarding:* ${p.name}\n*Price:* ${p.price} AED\n\n*Product Link:* ${pUrl}\n\nPlease let me know the availability.`;
    window.open(`https://wa.me/971561010387?text=${encodeURIComponent(msg)}`);
};

window.switchImg = (src, el) => {
    const main = document.getElementById('main-detail-img');
    if (main) {
        main.src = src;
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

window.renderAdminUI = () => {
    const pList = document.getElementById('admin-product-list');
    const cList = document.getElementById('admin-category-list');
    if (!pList || !cList) return;
    const searchEl = document.getElementById('admin-search');
    const filterEl = document.getElementById('admin-cat-filter');
    const searchQuery = searchEl ? searchEl.value.toLowerCase() : "";
    const catFilter = filterEl ? filterEl.value : "all";

    let products = DATA.p.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchQuery);
        const matchesCat = catFilter === 'all' || p.catId === catFilter;
        return matchesSearch && matchesCat;
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
            const pinIcon = p.isPinned ? '<div class="absolute top-3 left-3 w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg"><i class="fa-solid fa-thumbtack text-[10px]"></i></div>' : '';

            pHtml += `
        <div class="admin-product-card group">
            <div class="admin-product-img-box">
                <img src="${p.img}" alt="${p.name}">
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
        <img src="${c.img}" class="w-14 h-14 rounded-full object-cover border-4 border-white shadow-sm" onerror="this.src='https://placehold.co/100x100?text=Icon'">
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
};

window.handleCategoryRowScroll = (el) => {
    const container = el.parentElement;
    if (!container) return;
    const isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
    if (isAtEnd) container.classList.add('scrolled-end');
    else container.classList.remove('scrolled-end');
};

window.applyFilter = (id) => {
    state.filter = id;
    state.search = '';
    state.scrollPos = 0;
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
window.showAdminPanel = () => { document.getElementById('admin-panel').classList.remove('hidden'); document.body.style.overflow = 'hidden'; renderAdminUI(); };
window.hideAdminPanel = () => { document.getElementById('admin-panel').classList.add('hidden'); document.body.style.overflow = 'auto'; };

window.switchAdminTab = (tab) => {
    const isProd = tab === 'products';
    document.getElementById('admin-product-section').classList.toggle('hidden', !isProd);
    document.getElementById('admin-category-section').classList.toggle('hidden', isProd);
    document.getElementById('admin-product-list-container').classList.toggle('hidden', !isProd);
    document.getElementById('admin-category-list').classList.toggle('hidden', isProd);
    document.getElementById('product-admin-filters').classList.toggle('hidden', !isProd);
    document.getElementById('tab-p').className = isProd ? "flex-1 py-4 rounded-xl text-[10px] font-bold uppercase bg-white shadow-xl" : "flex-1 py-4 rounded-xl text-[10px] font-bold uppercase text-gray-400";
    document.getElementById('tab-c').className = !isProd ? "flex-1 py-4 rounded-xl text-[10px] font-bold uppercase bg-white shadow-xl" : "flex-1 py-4 rounded-xl text-[10px] font-bold uppercase text-gray-400";
    document.getElementById('list-title').innerText = isProd ? "Live Inventory" : "Existing Categories";
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

    if (document.getElementById('admin-search')) document.getElementById('admin-search').value = "";
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
    formData.append('upload_preset', 'speed_preset');
    formData.append('cloud_name', 'dxkcvm2yh');

    const res = await fetch(`https://api.cloudinary.com/v1_1/dxkcvm2yh/image/upload`, {
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
        cloudName: 'dxkcvm2yh',
        apiKey: '749457642941763',
        uploadPreset: 'speed_preset',
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

startSync();
