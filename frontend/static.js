let currentUser = null;
let products = [];
let cart = [];
let currentProduct = null;
let currentPeriod = 'monthly';
let dashboardInterval = null;
let editingProduct = null;
let editingPrices = null;


let orderedProducts = [];
let removedProducts = [];


let checkoutData = {
    method: null,
    address: '',
    date: '',
    time: '',
    payment: null,
    subtotal: 0,
    deliveryFee: 0,
    total: 0
};

let revenueChart = null;
let salesChart = null;
let topSellingChart = null;
let dayChart = null;
let monthChart = null;
let loginsChart = null;

let notificationsSeen = false;
let notificationTracking = {
    customer: {
        lastFetchedCount: 0,
        notifications: []
    },
    owner: {
        lastFetchedCount: 0,
        notifications: []
    }
};
let currentNotifications = [];

const CURRENCY = '₱';
const API_URL = '';
const DELIVERY_FEE = 50;

async function fetchProducts() {
    try {

        const response = await fetch(`${API_URL}/get-products-with-stock`);
        const data = await response.json();
        if (data.success) {
            products = data.products;


            renderProducts(products);
        }
        
        
        await fetchCategories();
        populateCategoryDropdowns();
    } catch (error) {
        console.error('Error fetching products:', error);

        try {
const fallbackResponse = await fetch(`${API_URL}/products`);
const fallbackData = await fallbackResponse.json();
if (fallbackData.success) {
products = fallbackData.products;
renderProducts(products);
}
        } catch (fallbackError) {
console.error('Error fetching fallback products:', fallbackError);
        }
    }
}


async function fetchCustomerHistory() {
    if (!currentUser || !currentUser.gmail) return;
    
    try {
        const response = await fetch(`${API_URL}/get-customer-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail: currentUser.gmail })
        });
        const data = await response.json();
        
        if (data.success) {
            orderedProducts = data.ordered_products || [];
            removedProducts = data.removed_products || [];
        }
    } catch (error) {
        console.error('Error fetching customer history:', error);
    }
}

function renderProducts(productsToRender) {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';

    productsToRender.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.onclick = () => openProductModal(product.name);
        
        const pricesHtml = Object.entries(product.prices).map(([qty, price]) => 
            `<span class="price-tag">${qty}pc - ${CURRENCY}${price}</span>`
        ).join('');
        
        
        const imageHtml = product.image 
            ? `<img src="/static/images/${product.image}" alt="${product.name}" onerror="this.style.display='none'; this.parentElement.querySelector('.fallback-icon').style.display='block';">
               <i class="fas fa-ribbon fallback-icon" style="display: none;"></i>`
            : `<i class="fas fa-ribbon"></i>`;
        
        card.innerHTML = `
            <div class="product-image">
                ${imageHtml}
            </div>
            <div class="product-info">
                <p class="product-category-tag">${product.category}</p>
                <h3>${product.name}</h3>
                <div class="product-prices">${pricesHtml}</div>
                <button class="view-details-btn" onclick="event.stopPropagation(); openProductModal('${product.name.replace(/'/g, "\\'")}")">
                    View Details
                </button>
            </div>
        `;
        
        grid.appendChild(card);
    });
}

function filterProducts() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const categoryFilter = document.getElementById('category-filter').value;

    let filtered = products;

    if (categoryFilter) {
        filtered = filtered.filter(p => p.category.toLowerCase() === categoryFilter.toLowerCase());
    }

    if (searchTerm) {
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(searchTerm) || 
            p.category.toLowerCase().includes(searchTerm)
        );
    }

    renderProducts(filtered);
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    const targetPage = document.getElementById(`${pageId}-page`);
    if (targetPage) targetPage.classList.add('active');

    const navBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (pageId === 'cart') {
        renderCart();
    } else if (pageId === 'order-status') {
        if (currentUser && currentUser.role === 'customer') {
            loadCustomerOrders();
        }
    } else if (pageId === 'dashboard') {
        loadDashboard();
        startDashboardAutoRefresh();
    } else if (pageId === 'profile') {
        if (currentUser && currentUser.gmail) {
            loadUserProfile();
        }
    } else if (pageId === 'products' && products.length === 0) {
        fetchProducts();
    } else if (pageId !== 'dashboard') {
        stopDashboardAutoRefresh();
    }

    window.scrollTo(0, 0);
}

// Store all orders globally for filtering
let allCustomerOrders = [];
let currentStatusFilter = 'to_pay';

async function loadCustomerOrders() {
    if (!currentUser || currentUser.role !== 'customer') {
        alert('Please login as customer');
        showLoginModal();
        return;
    }

    const listView = document.getElementById('orders-list-view');
    listView.innerHTML = '<div class="loading-message"><i class="fas fa-spinner fa-spin"></i> Loading orders...</div>';

    try {
        const response = await fetch(`${API_URL}/get-customer-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_gmail: currentUser.gmail })
        });
        const data = await response.json();

        if (data.success && data.orders && data.orders.length > 0) {
            allCustomerOrders = data.orders;
            updateStatusCounts();
            filterOrdersByStatus('to_pay');
        } else {
            allCustomerOrders = [];
            updateStatusCounts();
            listView.innerHTML = `
                <div class="no-orders-message">
                    <i class="fas fa-shopping-bag"></i>
                    <p>No orders found. <a href="#" onclick="showPage('products')">Start Shopping</a></p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading customer orders:', error);
        listView.innerHTML = '<div class="error-message"><i class="fas fa-exclamation-circle"></i> Error loading orders. Please try again.</div>';
    }
}

function updateStatusCounts() {
    const statusMap = {
        'to_pay': ['scheduled', 'payment_pending'],
        'paid': ['payment_confirmed'],
        'production': ['production'],
        'ready': ['done'],
        'receive': ['done'],
        'delivered': ['delivered'],
        'cancelled': ['cancelled']
    };

    Object.entries(statusMap).forEach(([filter, statuses]) => {
        const count = allCustomerOrders.filter(order => statuses.includes(order.status)).length;
        // Convert underscores to hyphens for ID lookup
        const elementId = filter.replace(/_/g, '-') + '-count';
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = count;
        }
    });
    
    // Update return/refund count
    const returnElement = document.getElementById('return-count');
    if (returnElement) {
        const returnCount = document.querySelectorAll('.order-card').length;
        // This will be updated when displaying return orders
    }
}

function filterOrdersByStatus(status) {
    currentStatusFilter = status;
    
    // Update active header
    document.querySelectorAll('.status-header').forEach(header => {
        header.classList.remove('active');
    });
    
    // Handle the selector correctly for all status types
    let headerClass;
    if (status === 'to_pay') {
        headerClass = 'to-pay-header';
    } else if (status === 'receive') {
        headerClass = 'receive-header';
    } else {
        headerClass = status + '-header';
    }
    const activeHeader = document.querySelector(`.${headerClass}`);
    if (activeHeader) {
        activeHeader.classList.add('active');
    }

    // If filter is 'return', fetch and display return requests
    if (status === 'return') {
        displayReturnRequests();
        return;
    }

    // Map filter to actual statuses
    const statusMap = {
        'to_pay': ['scheduled', 'payment_pending'],
        'paid': ['payment_confirmed'],
        'production': ['production'],
        'ready': ['done'],
        'receive': ['done'],
        'delivered': ['delivered'],
        'cancelled': ['cancelled']
    };

    const filteredOrders = allCustomerOrders.filter(order => statusMap[status].includes(order.status));
    
    const listView = document.getElementById('orders-list-view');
    
    if (filteredOrders.length === 0) {
        listView.innerHTML = `
            <div class="no-orders-message">
                <i class="fas fa-inbox"></i>
                <p>No ${status} orders yet</p>
            </div>
        `;
        return;
    }

    listView.innerHTML = '';
    filteredOrders.forEach(order => {
        const orderCard = createOrderCard(order, status);
        listView.appendChild(orderCard);
    });
}

function createOrderCard(order, filterType = '') {
    const card = document.createElement('div');
    card.className = 'order-card';

    const statusBadge = getStatusBadge(order.status, filterType);
    
    let actionContent = '';
    if (order.status === 'scheduled' || order.status === 'payment_pending') {
        actionContent = `<button class="action-btn cancel-btn" onclick="showCancelReasonModal('${order.order_id}')">
            <i class="fas fa-times"></i> Cancel Order
        </button>`;
    } else if (filterType === 'receive' && order.status === 'done') {
        actionContent = `<button class="action-btn received-btn" onclick="markOrderReceived('${order.order_id}')">
            <i class="fas fa-check"></i> Received
        </button>`;
    } else if (filterType === 'delivered' && order.status === 'delivered') {
        actionContent = `<button class="action-btn return-btn" onclick="openReturnRequestModal('${order.order_id}')">
            <i class="fas fa-redo"></i> Request Return/Refund
        </button>`;
    } else if (order.status === 'payment_confirmed' || order.status === 'done') {
        actionContent = `<button class="action-btn receipt-btn" onclick="printCustomerReceipt('${order.order_id}')">
            <i class="fas fa-print"></i> Print Receipt
        </button>`;
    } else if (order.status === 'cancelled') {
        const reason = order.cancel_reason ? `Reason: ${order.cancel_reason}` : 'No reason provided';
        actionContent = `<span class="cancel-reason-info">${reason}</span>`;
    } else {
        actionContent = `<span class="status-info">${getStatusMessage(order.status)}</span>`;
    }

    const itemsDisplay = formatOrderItemsDetails(order.items);

    card.innerHTML = `
        <div class="order-card-header">
            <div class="order-id-date">
                <h4 class="order-id">Order #${order.order_id}</h4>
                <span class="order-date">${order.formatted_date || 'N/A'}</span>
            </div>
            <div class="order-badge">
                ${statusBadge}
            </div>
        </div>
        <div class="order-card-body">
            <div class="order-items">
                <p class="items-label">Items:</p>
                <p class="items-content">${itemsDisplay}</p>
            </div>
            <div class="order-total">
                <span class="total-label">Total:</span>
                <span class="total-amount">${CURRENCY}${order.total || 0}</span>
            </div>
        </div>
        <div class="order-card-footer">
            ${actionContent}
        </div>
    `;

    return card;
}

function getStatusBadge(status, filterType = '') {
    const badges = {
        'pending': '<span class="status-badge status-pending">Pending</span>',
        'scheduled': '<span class="status-badge status-payment-pending">To Pay</span>',
        'payment_pending': '<span class="status-badge status-payment-pending">To Pay</span>',
        'payment_confirmed': '<span class="status-badge status-payment-confirmed">Payment Confirmed</span>',
        'production': '<span class="status-badge status-production">In Production</span>',
        'done': filterType === 'receive' ? '<span class="status-badge status-done">Ready to Receive</span>' : '<span class="status-badge status-done">Ready for Pickup</span>',
        'delivered': '<span class="status-badge status-delivered">Delivered</span>',
        'cancelled': '<span class="status-badge status-cancelled">Cancelled</span>'
    };
    return badges[status] || '<span class="status-badge status-unknown">Unknown</span>';
}

function getStatusMessage(status) {
    const messages = {
        'pending': 'Waiting for payment confirmation',
        'scheduled': 'Waiting for payment - Please send payment proof to owner',
        'payment_pending': 'Please send payment proof to owner',
        'payment_confirmed': 'Payment received - View receipt',
        'production': 'Order being prepared',
        'done': 'Ready for pickup/delivery',
        'delivered': 'Order delivered successfully',
        'cancelled': 'Order cancelled'
    };
    return messages[status] || 'Processing...';
}

function formatOrderItemsDetails(items) {
    if (!items || items.length === 0) return 'No items';
    
    return items.map(item => {
        let itemStr = item.name;
        if (item.details) {
            itemStr += ` (${item.details})`;
        } else {
            if (item.variant && item.variant !== 'DEFAULT') {
                itemStr += ` - ${item.variant}`;
            }
            if (item.quantity) {
                itemStr += ` x${item.quantity}`;
            }
        }
        return itemStr;
    }).join(', ');
}

async function printCustomerReceipt(orderId) {
    console.log('printCustomerReceipt called with:', orderId);
    
    try {
        const response = await fetch(`${API_URL}/generate-receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId })
        });
        const data = await response.json();
        
        if (data.success) {
            robustPopulateCustomerReceipt(data);
            document.getElementById('customer-receipt-modal').classList.add('active');
        } else {
            alert('Receipt not found. Order may not be ready.');
        }
    } catch (error) {
        console.error('Error loading customer receipt:', error);
        alert('Error loading receipt. Please contact store.');
    }
}

function robustPopulateCustomerReceipt(data) {
    const safeSetText = (selector, value) => {
        const el = document.getElementById(selector);
        if (el) el.textContent = value || '';
    };
    
    const safeToggleDisplay = (selector, condition) => {
        const el = document.getElementById(selector);
        if (el) el.style.display = condition ? 'block' : 'none';
    };
    
    safeSetText('customer-receipt-order-id', data.order_id);
    safeSetText('customer-receipt-date', data.date);
    safeSetText('customer-receipt-customer', data.customer);
    safeSetText('customer-receipt-address', data.address || '');
    safeSetText('customer-receipt-time', data.time || '');
    
    
    const itemsList = document.getElementById('customer-receipt-items-list');
    if (itemsList) {
        itemsList.innerHTML = '';
        (data.items || []).forEach(item => {
            const div = document.createElement('div');
            div.className = 'receipt-item';
            let itemDisplay = item.name;
            
            // Include variant details (colors, flavors, quantity, add-ons)
            if (item.details) {
                itemDisplay += ` (${item.details})`;
            } else if (item.color || item.flavor) {
                itemDisplay += ` - ${item.color || item.flavor}`;
                if (item.quantity) {
                    itemDisplay += ` x${item.quantity}`;
                }
            }
            
            div.innerHTML = `
                <span class="receipt-item-name">${itemDisplay || 'Item'}</span>
                <span class="receipt-item-price">${CURRENCY}${item.price || 0}</span>
            `;
            itemsList.appendChild(div);
        });
    }
    
    safeSetText('customer-receipt-subtotal', `${CURRENCY}${data.subtotal || 0}`);
    safeSetText('customer-receipt-delivery-fee', `${CURRENCY}${data.delivery_fee || 0}`);
    safeSetText('customer-receipt-total', `${CURRENCY}${data.total || 0}`);
    safeSetText('customer-receipt-payment', (data.payment || 'CASH').toUpperCase());
    
    const deliveryFeeLine = document.getElementById('customer-receipt-delivery-fee-line');
    if (deliveryFeeLine) {
        deliveryFeeLine.style.display = (data.delivery_fee || 0) > 0 ? 'flex' : 'none';
    }
    safeToggleDisplay('customer-receipt-delivery-info', !!data.address);
    
    console.log('Customer receipt populated:', data.order_id);
}

function printCustomerReceiptModal() {
    const customerReceiptModal = document.getElementById('customer-receipt-modal');
    if (customerReceiptModal && customerReceiptModal.classList.contains('active')) {
        window.print();
    }
}

function closeCustomerReceiptModal() {
    document.getElementById('customer-receipt-modal').classList.remove('active');
}

function startDashboardAutoRefresh() {
    if (dashboardInterval) clearInterval(dashboardInterval);
    dashboardInterval = setInterval(() => {
        if (currentUser && currentUser.role === 'owner') {
            loadDashboardData(currentPeriod);
        }
    }, 30000);
}

function stopDashboardAutoRefresh() {
    if (dashboardInterval) {
        clearInterval(dashboardInterval);
        dashboardInterval = null;
    }
}

function toggleMobileMenu() {
    document.querySelector('.main-nav').classList.toggle('active');
}

// CUSTOMER LOGIN MODAL
function showLoginModal() {
    const modal = document.getElementById('customer-login-modal');
    if (modal) {
        modal.classList.add('active');
        console.log('Customer login modal opened!');
    } else {
        console.error('Customer login modal element not found!');
    }
}

function closeCustomerLoginModal() {
    document.getElementById('customer-login-modal').classList.remove('active');
}

// CUSTOMER REGISTER MODAL
function showCustomerRegisterModal() {
    const modal = document.getElementById('customer-register-modal');
    if (modal) {
        modal.classList.add('active');
        console.log('Customer register modal opened!');
    } else {
        console.error('Customer register modal element not found!');
    }
}

function closeCustomerRegisterModal() {
    document.getElementById('customer-register-modal').classList.remove('active');
}

// OTP VERIFICATION MODAL
function showOtpVerificationModal() {
    const modal = document.getElementById('otp-verification-modal');
    if (modal) {
        modal.classList.add('active');
    }
}

function closeOtpVerificationModal() {
    const modal = document.getElementById('otp-verification-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    localStorage.removeItem('pendingOtpEmail');
}

async function verifyRegistrationOtp() {
    const otp = document.getElementById('otp-code').value.trim();
    const gmail = localStorage.getItem('pendingOtpEmail');

    if (!otp) {
        alert('Please enter the OTP code');
        return;
    }

    if (otp.length !== 6) {
        alert('OTP must be 6 digits');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/verify-registration-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, otp })
        });
        const data = await response.json();

        if (data.success) {
            alert('Email verified successfully! You can now login.');
            
            // Clear the registration form
            document.getElementById('register-gmail').value = '';
            document.getElementById('register-password').value = '';
            document.getElementById('register-confirm-password').value = '';
            document.getElementById('otp-code').value = '';
            
            // Close OTP modal and show login modal
            document.getElementById('otp-verification-modal').classList.remove('active');
            localStorage.removeItem('pendingOtpEmail');
            document.getElementById('customer-gmail').value = gmail;
            showLoginModal();
        } else {
            alert(data.message || 'OTP verification failed');
        }
    } catch (error) {
        console.error('OTP verification error:', error);
        alert('Verification failed. Please try again.');
    }
}

// OWNER LOGIN MODAL
function showOwnerLoginModal() {
    const modal = document.getElementById('owner-login-modal');
    if (modal) {
        modal.classList.add('active');
        console.log('Owner login modal opened!');
    } else {
        console.error('Owner login modal element not found!');
    }
}

function closeOwnerLoginModal() {
    document.getElementById('owner-login-modal').classList.remove('active');
}

// SWITCH BETWEEN MODALS
function switchToCustomerRegisterModal() {
    closeCustomerLoginModal();
    showCustomerRegisterModal();
}

function switchToCustomerLoginModal() {
    closeCustomerRegisterModal();
    showLoginModal();
}

function switchToOwnerLoginModal() {
    closeCustomerLoginModal();
    showOwnerLoginModal();
}

async function customerLogin() {
    const gmail = document.getElementById('customer-gmail').value.trim().toLowerCase();
    const password = document.getElementById('customer-password').value;

    if (!gmail) {
        alert('Please enter your Gmail address');
        return;
    }

    if (!gmail.endsWith('@gmail.com')) {
        alert('Please use a valid Gmail address (@gmail.com)');
        return;
    }

    if (!password) {
        alert('Please enter your password');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/customer-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, password })
        });
        const data = await response.json();

        if (data.success) {
            currentUser = { gmail: data.gmail, role: 'customer' };
            updateUIAfterLogin();
            closeCustomerLoginModal();
            await fetchCustomerHistory();
            await loadCart();
            await fetchProducts();
            await loadUserProfile(); // Load user profile after login
            startNotificationRefresh();
            showPage('products');
        } else {
            alert(data.message);
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please try again.');
    }
}

async function customerRegister() {
    const gmail = document.getElementById('register-gmail').value.trim().toLowerCase();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    if (!gmail) {
        alert('Please enter your Gmail address');
        return;
    }

    if (!gmail.endsWith('@gmail.com')) {
        alert('Please use a valid Gmail address (@gmail.com)');
        return;
    }

    if (!password) {
        alert('Please enter a password');
        return;
    }

    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }

    if (password !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/customer-register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, password, confirm_password: confirmPassword })
        });
        const data = await response.json();

        if (data.success) {
            // Store the gmail for OTP verification
            localStorage.setItem('pendingOtpEmail', gmail);
            
            // Show OTP modal
            document.getElementById('otp-email-display').textContent = gmail;
            document.getElementById('otp-code').value = '';
            document.getElementById('customer-register-modal').classList.remove('active');
            document.getElementById('otp-verification-modal').classList.add('active');
        } else {
            alert(data.message);
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Registration failed. Please try again.');
    }
}

async function ownerLogin() {
    const gmail = document.getElementById('owner-gmail').value.trim().toLowerCase();
    const password = document.getElementById('owner-password').value;

    if (!gmail || !password) {
        alert('Please enter Gmail and password');
        return;
    }

    if (!gmail.endsWith('@gmail.com')) {
        alert('Please use a valid Gmail address');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/owner-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail, password })
        });
        const data = await response.json();

        if (data.success) {
            currentUser = { gmail: data.gmail, role: 'owner' };
            updateUIAfterLogin();
            closeOwnerLoginModal();
            startNotificationRefresh();
            showPage('dashboard');
        } else {
            alert(data.message || 'Invalid owner credentials');
        }
    } catch (error) {
        console.error('Owner login error:', error);
        alert('Login failed. Please try again.');
    }
}

function updateUIAfterLogin() {
    document.getElementById('login-btn').style.display = 'none';
    document.getElementById('owner-login-btn').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'flex';
    document.getElementById('messages-btn').style.display = 'flex';
    document.getElementById('user-gmail').textContent = currentUser.gmail.split('@')[0];

    // Show role-specific nav buttons
    document.querySelectorAll('.customer-only').forEach(btn => btn.style.display = 'flex');
    document.querySelectorAll('.user-only').forEach(btn => btn.style.display = 'flex');
    document.querySelectorAll('.owner-only').forEach(btn => btn.style.display = 'none');

    if (currentUser.role === 'owner') {
        document.getElementById('dashboard-btn').style.display = 'flex';
        document.getElementById('user-info-btn').style.display = 'none';
        document.querySelectorAll('.customer-only').forEach(btn => btn.style.display = 'none');
        document.querySelectorAll('.owner-only').forEach(btn => btn.style.display = 'flex');
    } else {
        document.getElementById('dashboard-btn').style.display = 'none';
        document.getElementById('user-info-btn').style.display = 'flex';
        document.querySelectorAll('.customer-only').forEach(btn => btn.style.display = 'flex');
        document.querySelectorAll('.owner-only').forEach(btn => btn.style.display = 'none');
    }
}


let logoutVersion = 0;

function logout() {
    // Invalidate any in-flight async UI calls
    logoutVersion++;
    const thisLogoutVersion = logoutVersion;

    currentUser = null;
    cart = [];
    orderedProducts = [];
    removedProducts = [];

    // Clear user/profile info UI immediately to prevent stale display
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) profileAvatar.src = '/static/images/default-avatar.svg';

    const profileUsername = document.getElementById('profile-username');
    if (profileUsername) profileUsername.textContent = 'User';

    const profileGmail = document.getElementById('profile-gmail');
    if (profileGmail) profileGmail.textContent = '';

    const profileMemberSince = document.getElementById('profile-member-since');
    if (profileMemberSince) profileMemberSince.textContent = '';

    // Also clear nav user gmail text (avatar stays handled by image above)
    const navProfileImage = document.getElementById('nav-profile-image');
    if (navProfileImage) navProfileImage.src = '/static/images/default-avatar.svg';

    const userGmailNav = document.getElementById('user-gmail');
    if (userGmailNav) userGmailNav.textContent = '';

    // Clear profile stats
    const totalOrdersCount = document.getElementById('total-orders-count');
    if (totalOrdersCount) totalOrdersCount.textContent = '0';
    const deliveredCountStat = document.getElementById('delivered-count-stat');
    if (deliveredCountStat) deliveredCountStat.textContent = '0';
    const totalSpentStat = document.getElementById('total-spent-stat');
    if (totalSpentStat) totalSpentStat.textContent = '₱0';

    updateCartBadge();
    stopDashboardAutoRefresh();
    stopNotificationRefresh();
    closeNotificationHeader();
    clearNotificationBadges();

    document.getElementById('login-btn').style.display = 'flex';
    document.getElementById('owner-login-btn').style.display = 'flex';
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('user-info-btn').style.display = 'none';
    document.getElementById('dashboard-btn').style.display = 'none';
    document.getElementById('messages-btn').style.display = 'none';

    document.querySelectorAll('.customer-only').forEach(btn => btn.style.display = 'none');
    document.querySelectorAll('.user-only').forEach(btn => btn.style.display = 'none');
    document.querySelectorAll('.owner-only').forEach(btn => btn.style.display = 'none');

    showPage('welcome');

    // Avoid unused var warning - keep reference for debugging if needed
    void thisLogoutVersion;
}

function showLogoutConfirmation() {
    document.getElementById('logout-confirmation-modal').classList.add('active');
}

function closeLogoutConfirmation() {
    document.getElementById('logout-confirmation-modal').classList.remove('active');
}

function confirmLogout() {
    closeLogoutConfirmation();
    logout();
}

async function openProductModal(productName) {
    
    currentProduct = products.find(p => p.name === productName);
    
    if (!currentProduct) {
        
        try {
            const response = await fetch(`${API_URL}/products`);
            const data = await response.json();
            if (data.success) {
                currentProduct = data.products.find(p => p.name === productName);
            }
        } catch (error) {
            console.error('Error loading product:', error);
        }
    }
    
    if (!currentProduct) return;

    document.getElementById('modal-product-name').textContent = currentProduct.name;
    document.getElementById('modal-product-category').textContent = currentProduct.category;
    
    const firstQty = Object.keys(currentProduct.prices)[0];
    document.getElementById('modal-product-price').textContent = `${CURRENCY}${currentProduct.prices[firstQty]}`;

    const qtySelect = document.getElementById('modal-quantity');
    qtySelect.innerHTML = '';
    Object.entries(currentProduct.prices).forEach(([qty, price]) => {
        const option = document.createElement('option');
        option.value = qty;
        option.textContent = `${qty} pcs - ${CURRENCY}${price}`;
        qtySelect.appendChild(option);
    });
    qtySelect.onchange = updateModalPrice;

    const colorGroup = document.getElementById('color-select-group');
    const colorSelect = document.getElementById('modal-color');
    if (currentProduct.variants && currentProduct.variants.length > 0) {
        
        const colorVariants = currentProduct.variants.filter(v => v.type === 'color');
        if (colorVariants.length > 0) {
            colorGroup.style.display = 'block';
            colorSelect.innerHTML = '';
            colorVariants.forEach(variant => {
                const option = document.createElement('option');
                option.value = variant.name;
                option.textContent = variant.available ? variant.name : `${variant.name} (Unavailable)`;
                if (!variant.available) {
                    option.disabled = true;
                    option.style.color = '#999';
                }
                colorSelect.appendChild(option);
            });
        } else {
            colorGroup.style.display = 'none';
        }
    } else if (currentProduct.colors && currentProduct.colors.length > 0) {
        
        colorGroup.style.display = 'block';
        colorSelect.innerHTML = '';
        currentProduct.colors.forEach(color => {
            const option = document.createElement('option');
            option.value = color;
            option.textContent = color;
            colorSelect.appendChild(option);
        });
    } else {
        colorGroup.style.display = 'none';
    }

    const flavorGroup = document.getElementById('flavor-select-group');
    const flavorSelect = document.getElementById('modal-flavor');
    if (currentProduct.variants && currentProduct.variants.length > 0) {
        
        const flavorVariants = currentProduct.variants.filter(v => v.type === 'flavor');
        if (flavorVariants.length > 0) {
            flavorGroup.style.display = 'block';
            flavorSelect.innerHTML = '';
            flavorVariants.forEach(variant => {
                const option = document.createElement('option');
                option.value = variant.name;
                option.textContent = variant.available ? variant.name : `${variant.name} (Unavailable)`;
                if (!variant.available) {
                    option.disabled = true;
                    option.style.color = '#999';
                }
                flavorSelect.appendChild(option);
            });
        } else {
            flavorGroup.style.display = 'none';
        }
    } else if (currentProduct.flavors && currentProduct.flavors.length > 0) {
        
        flavorGroup.style.display = 'block';
        flavorSelect.innerHTML = '';
        currentProduct.flavors.forEach(flavor => {
            const option = document.createElement('option');
            option.value = flavor;
            option.textContent = flavor;
            flavorSelect.appendChild(option);
        });
    } else {
        flavorGroup.style.display = 'none';
    }

    const addonGroup = document.getElementById('addon-select-group');
    const addonContainer = document.getElementById('modal-addons');
    if (currentProduct.addons && Object.keys(currentProduct.addons).length > 0) {
        addonGroup.style.display = 'block';
        addonContainer.innerHTML = '';
        Object.entries(currentProduct.addons).forEach(([name, price]) => {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            label.innerHTML = `<input type="checkbox" value="${name}" data-price="${price}"> ${name} (+${CURRENCY}${price})`;
            addonContainer.appendChild(label);
        });
    } else {
        addonGroup.style.display = 'none';
    }

    document.getElementById('modal-product-image').src = `/static/images/${currentProduct.image}`;
    document.getElementById('product-modal').classList.add('active');
}

function updateModalPrice() {
    const qty = document.getElementById('modal-quantity').value;
    const price = currentProduct.prices[qty];
    document.getElementById('modal-product-price').textContent = `${CURRENCY}${price}`;
}

function closeProductModal() {
    document.getElementById('product-modal').classList.remove('active');
    currentProduct = null;
}

function addToCartFromModal() {
    if (!currentUser) {
        alert('Please login to add items to cart');
        showLoginModal();
        return;
    }

    const qty = document.getElementById('modal-quantity').value;
    const color = document.getElementById('modal-color').value;
    const flavor = document.getElementById('modal-flavor').value;
    
    
    if (currentProduct.variants && currentProduct.variants.length > 0) {
        const selectedVariant = color || flavor;
        if (selectedVariant) {
            const variantInfo = currentProduct.variants.find(v => v.name === selectedVariant);
            if (variantInfo && variantInfo.available === false) {
                alert(`Sorry, ${selectedVariant} is currently unavailable. Please choose a different ${color ? 'color' : 'flavor'}.`);
                return;
            }
        }
    }
    
    let basePrice = currentProduct.prices[qty];
    let itemName = currentProduct.name;
    let itemDetails = `${qty} pcs`;

    if (color) itemDetails += ` - ${color}`;
    if (flavor) itemDetails += ` - ${flavor}`;

    const addons = [];
    let addonPrice = 0;
    document.querySelectorAll('#modal-addons input:checked').forEach(checkbox => {
        addons.push(checkbox.value);
        addonPrice += parseInt(checkbox.dataset.price);
    });

    if (addons.length > 0) itemDetails += ` + ${addons.join(', ')}`;

    const totalPrice = basePrice + addonPrice;

    const cartItem = {
        product: currentProduct,
        name: itemName,
        details: itemDetails,
        quantity: parseInt(qty),
        color: color,
        flavor: flavor,
        addons: addons,
        price: totalPrice,
        variant: color || flavor || 'DEFAULT'
    };

    cart.push(cartItem);
    updateCartBadge();
    saveCart();
    closeProductModal();
    alert('Item added to cart!');
}


function getCartItemsForOrder() {
    return cart.map(item => ({
        name: item.name,
        quantity: item.quantity || 1,
        price: item.price
    }));
}

function updateCartBadge() {
    document.getElementById('cart-badge').textContent = cart.length;
}

async function loadCart() {
    if (!currentUser || !currentUser.gmail) return;
    
    try {
        const response = await fetch(`${API_URL}/load-cart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail: currentUser.gmail })
        });
        const data = await response.json();
        
        if (data.success && data.cart && data.cart.length > 0) {
            cart = data.cart;
           
            if (orderedProducts.length > 0) {
                cart = cart.filter(item => !orderedProducts.includes(item.name));
            }
            updateCartBadge();
        }
        
        
        if (data.success && data.removed_products) {
            removedProducts = data.removed_products;
        }
    } catch (error) {
        console.error('Error loading cart:', error);
    }
}

async function saveCart() {
    if (!currentUser || !currentUser.gmail) return;
    
    try {
        
        const cartToSave = cart.filter(item => !orderedProducts.includes(item.name));
        
        await fetch(`${API_URL}/save-cart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                gmail: currentUser.gmail, 
                cart: cartToSave,
                removed_products: removedProducts
            })
        });
    } catch (error) {
        console.error('Error saving cart:', error);
    }
}

function renderCart() {
    const container = document.getElementById('cart-items');
    const summary = document.getElementById('cart-summary');

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-cart">
                <i class="fas fa-shopping-cart"></i>
                <p>Your cart is empty</p>
                <button class="cta-btn" onclick="showPage('products')">Browse Products</button>
            </div>
        `;
        summary.style.display = 'none';
        return;
    }

    summary.style.display = 'block';
    container.innerHTML = '';

    let subtotal = 0;

    cart.forEach((item, index) => {
        subtotal += item.is_bundle ? item.total_price : item.price;
        
        if (item.is_bundle) {
            const cartItem = document.createElement('div');
            cartItem.className = 'cart-item-bundle';
            cartItem.innerHTML = `
                <div class="cart-item-bundle-header">
                    <h4><i class="fas fa-gift"></i> ${item.details}</h4>
                    <button class="remove-item-btn" onclick="removeFromCart(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="bundle-items-list">
                    ${item.items.map(bundleItem => `
                        <div class="bundle-product-item">
                            <span>${bundleItem.name} - ${bundleItem.details}</span>
                            <span>₱${bundleItem.price}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="bundle-item-price" style="text-align:right;margin-top:10px;font-size:1.2rem;">
                    <strong>Total: ₱${item.total_price}</strong>
                </div>
            `;
            container.appendChild(cartItem);
        } else {
            const cartItem = document.createElement('div');
            cartItem.className = 'cart-item';
            cartItem.innerHTML = `
                <div class="cart-item-info">
                    <h4>${item.name}</h4>
                    <p>${item.details}</p>
                </div>
                <div class="cart-item-price">${CURRENCY}${item.price}</div>
                <button class="remove-item-btn" onclick="removeFromCart(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            container.appendChild(cartItem);
        }
    });

    document.getElementById('cart-subtotal').textContent = `${CURRENCY}${subtotal}`;
    document.getElementById('cart-total').textContent = `${CURRENCY}${subtotal}`;
}

function removeFromCart(index) {
    const removedItem = cart[index];
    
    
    if (removedItem && removedItem.name) {
        if (!removedProducts.includes(removedItem.name)) {
            removedProducts.push(removedItem.name);
        }
    }
    
    cart.splice(index, 1);
    updateCartBadge();
    renderCart();
    saveCart();
}

async function checkout() {
    if (!currentUser) {
        alert('Please login to checkout');
        showLoginModal();
        return;
    }

    if (cart.length === 0) {
        alert('Your cart is empty');
        return;
    }

    const total = cart.reduce((sum, item) => sum + item.price, 0);
    const order = {
        customer_gmail: currentUser.gmail,
        items: cart.map(item => ({ name: item.name, details: item.details, price: item.price, variant: item.variant || 'DEFAULT', quantity: item.quantity || 1 })),
        total: total,
        created_at: new Date().toISOString()
    };

    try {
        const response = await fetch(`${API_URL}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
        });
        const data = await response.json();

        if (data.success) {
            alert(`Order placed successfully! Order ID: ${data.order_id}`);
            cart = [];
            updateCartBadge();
            showPage('products');
        }
    } catch (error) {
        console.error('Error placing order:', error);
        alert('Order placed successfully!');
        cart = [];
        updateCartBadge();
        showPage('products');
    }
}

function changePeriod(period) {
    currentPeriod = period;
    document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.period-btn[data-period="${period}"]`).classList.add('active');
    loadDashboardData(period);
}

async function loadDashboard() {
    if (!currentUser || currentUser.role !== 'owner') {
        showPage('welcome');
        return;
    }
    
   
    try {
        await fetch(`${API_URL}/fix-inventory`, { method: 'POST' });
    } catch (e) {
        console.log('Inventory fix skipped');
    }
    
    loadDashboardData(currentPeriod);
    loadSimpleOrderManagement();
    loadReturnRefundManagement();
    loadOwnerAccountSettings();
}

async function loadDashboardData(period) {
    try {
        const response = await fetch(`${API_URL}/dashboard-data?period=${period}`);
        const data = await response.json();

        if (data.success) {
            document.getElementById('total-orders').textContent = data.total_orders;
            document.getElementById('total-revenue').textContent = `${CURRENCY}${data.total_revenue}`;
            document.getElementById('period-orders').textContent = data.period_orders;
            document.getElementById('period-revenue').textContent = `${CURRENCY}${data.period_revenue}`;

            if (data.low_stock && data.low_stock.length > 0) {
                const lowStockNames = data.low_stock.map(item => item.product_name).join(', ');
                document.getElementById('low-stock-items').textContent = lowStockNames;
                document.getElementById('low-stock-alert').style.display = 'flex';
            } else {
                document.getElementById('low-stock-alert').style.display = 'none';
            }

            renderRevenueChart(data.daily_sales);
            renderDayChart(data.sales_by_day);
            renderMonthChart(data.sales_by_month);
            renderSalesChart(data.product_sales);
            renderTopSellingChart(data.product_sales);
            renderLoginsChart(data.daily_logins || {}, data.logins_by_day || {});
            renderCustomerNotifications(data.recent_logins || []);

            const tbody = document.getElementById('orders-table-body') || document.getElementById('simple-order-management-body');
            if (tbody) {
                tbody.innerHTML = '';
                data.orders.forEach(order => {
                    const statusBadge = getStatusBadge(order.status);
                    const paymentBadge = getPaymentBadge(order.payment);
                    const itemsDetails = formatOrderItemsDetails(order.items);
                    const date = new Date(order.created_at).toLocaleDateString();
                    const actions = getOrderActions(order);
                    
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td><strong>${order.order_id}</strong></td>
                        <td>${order.customer_gmail}</td>
                        <td title="${itemsDetails}">${itemsDetails}</td>
                        <td>${CURRENCY}${order.total}</td>
                        <td>${paymentBadge}</td>
                        <td>${statusBadge}</td>
                        <td>${date}</td>
                        <td>${actions}</td>
                    `;
                    tbody.appendChild(row);
                });
            }
            
            const notificationBadge = document.getElementById('notification-badge');
            if (notificationBadge) {
                if (data.notifications > 0) {
                    notificationBadge.textContent = data.notifications;
                    notificationBadge.style.display = 'flex';
                } else {
                    notificationBadge.style.display = 'none';
                }
            }
            
            const pendingOrdersContainer = document.getElementById('pending-orders-container');
            if (pendingOrdersContainer && data.pending_orders) {
                pendingOrdersContainer.innerHTML = '';
                data.pending_orders.forEach(order => {
                    const orderDiv = document.createElement('div');
                    orderDiv.className = 'pending-order-card';
                    orderDiv.innerHTML = `
                        <div class="pending-order-info">
                            <strong>${order.order_id}</strong>
                            <span>${order.customer_gmail}</span>
                            <span>${CURRENCY}${order.total}</span>
                        </div>
                        <div class="pending-order-actions">
                            <button class="action-btn deliver-btn" onclick="updateOrderStatus('${order.order_id}', 'delivered')">Delivered</button>
                            <button class="action-btn cancel-btn" onclick="updateOrderStatus('${order.order_id}', 'cancelled')">Cancelled</button>
                        </div>
                    `;
                    pendingOrdersContainer.appendChild(orderDiv);
                });
            }
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function updateOrderStatus(orderId, status) {
    try {
        const response = await fetch(`${API_URL}/update-order-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, status: status })
        });
        const data = await response.json();
        
        if (data.success) {
            if (status === 'delivered') {
                alert('Order marked as delivered!');
            } else {
                alert('Order cancelled!');
            }
            loadDashboardData(currentPeriod);
        } else {
            alert('Failed to update order status');
        }
    } catch (error) {
        console.error('Error updating order status:', error);
        alert('Error updating order status');
    }
}

function renderDayChart(salesByDay) {
    const ctx = document.getElementById('day-chart').getContext('2d');
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const sales = dayNames.map(day => salesByDay[day] || 0);

    if (dayChart) dayChart.destroy();

    dayChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dayNames,
            datasets: [{
                label: 'Orders',
                data: sales,
                backgroundColor: ['#FF69B4', '#FFB6C1', '#DB7093', '#FFC0CB', '#FF1493', '#C71585', '#FF69B4'],
                borderRadius: 8
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}

function renderMonthChart(salesByMonth) {
    const ctx = document.getElementById('month-chart').getContext('2d');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const sales = monthNames.map(month => salesByMonth[month] || 0);

    if (monthChart) monthChart.destroy();

    monthChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthNames,
            datasets: [{
                label: 'Orders',
                data: sales,
                backgroundColor: ['#FF69B4', '#FFB6C1', '#DB7093', '#FFC0CB', '#FF1493', '#C71585', '#FFB6C1', '#DB7093', '#FF69B4', '#FF1493', '#C71585', '#FFB6C1'],
                borderRadius: 8
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}

function renderRevenueChart(dailySales) {
    const ctx = document.getElementById('revenue-chart').getContext('2d');
    const sortedDates = Object.keys(dailySales).sort();
    const revenues = sortedDates.map(date => dailySales[date]);

    if (revenueChart) revenueChart.destroy();

    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedDates.map(date => {
                const d = new Date(date);
                return `${d.getDate()}/${d.getMonth() + 1}`;
            }),
            datasets: [{
                label: `Revenue (${CURRENCY})`,
                data: revenues,
                borderColor: '#FF69B4',
                backgroundColor: 'rgba(255, 105, 180, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: value => CURRENCY + value }
                }
            }
        }
    });
}

function renderSalesChart(productSales) {
    const ctx = document.getElementById('sales-chart').getContext('2d');
    const products = Object.keys(productSales);
    const sales = Object.values(productSales);

    if (salesChart) salesChart.destroy();

    salesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: products,
            datasets: [{
                label: 'Units Sold',
                data: sales,
                backgroundColor: ['#FF69B4', '#FFB6C1', '#DB7093', '#FFC0CB', '#FF1493', '#C71585', '#FFB6C1', '#DB7093', '#FF69B4', '#FF1493'],
                borderRadius: 8
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}

function renderTopSellingChart(productSales) {
    const ctx = document.getElementById('top-selling-chart').getContext('2d');
    const sorted = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const products = sorted.map(item => item[0]);
    const sales = sorted.map(item => item[1]);

    if (topSellingChart) topSellingChart.destroy();

    topSellingChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: products,
            datasets: [{
                data: sales,
                backgroundColor: ['#FF69B4', '#FFB6C1', '#DB7093', '#FFC0CB', '#FF1493'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

function renderLoginsChart(dailyLogins, loginsByDay) {
    const ctx = document.getElementById('logins-chart').getContext('2d');
    
   
    const sortedDates = Object.keys(dailyLogins).sort();
    const loginCounts = sortedDates.map(date => dailyLogins[date]);
    
    
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const loginsPerDay = dayNames.map(day => loginsByDay[day] || 0);

    if (loginsChart) loginsChart.destroy();

    loginsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dayNames,
            datasets: [{
                label: 'Customer Logins',
                data: loginsPerDay,
                backgroundColor: ['#9C27B0', '#7B1FA2', '#6A1B9A', '#4A148C', '#38006b', '#301c56', '#9C27B0'],
                borderRadius: 8
            }]
        },
        options: { 
            responsive: true, 
            plugins: { legend: { display: false } }, 
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } 
        }
    });
}

function renderCustomerNotifications(recentLogins) {
    const container = document.getElementById('customer-notifications-list');
    
    if (!recentLogins || recentLogins.length === 0) {
        container.innerHTML = `
            <div class="empty-notifications">
                <i class="fas fa-bell-slash"></i>
                <p>No recent customer logins</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    recentLogins.forEach(login => {
        const loginDate = new Date(login.login_time);
        const formattedDate = loginDate.toLocaleDateString();
        const formattedTime = loginDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const notificationItem = document.createElement('div');
        notificationItem.className = 'notification-item';
        notificationItem.innerHTML = `
            <div class="notification-icon">
                <i class="fas fa-user-circle"></i>
            </div>
            <div class="notification-content">
                <p class="notification-gmail">${login.gmail}</p>
                <p class="notification-time">${formattedDate} at ${formattedTime}</p>
            </div>
        `;
        container.appendChild(notificationItem);
    });
}

async function renderManagementTable(inventory) {
    try {
        
        const response = await fetch(`${API_URL}/get-products-with-stock?owner=1`);
        const data = await response.json();
        
        if (data.success) {
            displayManagementTableWithAvailability(data.products, inventory);
        }
    } catch (error) {
        console.error('Error loading products for management:', error);
    }
}

function displayManagementTableWithAvailability(products, inventory) {
    const tbody = document.getElementById('management-table-body');
    if (!tbody) {
        console.warn('management-table-body not found in DOM, skipping displayManagementTableWithAvailability');
        return;
    }
    tbody.innerHTML = '';

    const searchTerm = document.getElementById('management-search')?.value.toLowerCase() || '';
    const filtered = products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.category.toLowerCase().includes(searchTerm));

    filtered.forEach(product => {
        
        const totalStock = product.variants ? product.variants.reduce((sum, v) => sum + (v.stock || 0), 0) : 0;
        const stockClass = totalStock < 10 ? 'low-stock' : 'in-stock';
        
        const pricesStr = Object.entries(product.prices).map(([qty, price]) => `${qty}:${CURRENCY}${price}`).join(', ');
        

        let variantsHtml = '';
        if (product.variants && product.variants.length > 0) {
            variantsHtml = '<div class="variants-list">';
            product.variants.forEach(variant => {
                const isAvailable = variant.available !== false;
                const statusClass = isAvailable ? 'variant-available' : 'variant-unavailable';
                const statusIcon = isAvailable ? '✓' : '✗';
                const btnText = isAvailable ? 'Disable' : 'Enable';
                const btnClass = isAvailable ? 'toggle-off-btn' : 'toggle-on-btn';
                const stockWarning = variant.stock < 10 ? '<span style="color: #ff6b6b; margin-left: 10px; font-weight: bold;"> LOW</span>' : '';
                
                
                variantsHtml += `
                    <div class="variant-item ${statusClass}">
                        <span class="variant-name">${variant.name}</span>
                        <span class="variant-stock" style="cursor:pointer; background: #f0f0f0; padding: 5px 10px; border-radius: 4px; margin: 0 10px;" onclick="openStockEdit('${product.name.replace(/'/g, "\\'")}', ${variant.stock}, '${variant.name.replace(/'/g, "\\'")}')"> Stock: <strong>${variant.stock}</strong> <i class="fas fa-edit" style="font-size:10px; margin-left: 5px;"></i>${stockWarning}</span>
                        <span class="variant-status">${statusIcon} ${variant.status}</span>
                        <button class="${btnClass}" onclick="toggleAvailability('${product.name.replace(/'/g, "\\'")}', '${variant.name.replace(/'/g, "\\'")}')">
                            ${btnText}
                        </button>
                    </div>
                `;
            });
            variantsHtml += '</div>';
            
            
            if (product.unavailable_variants && product.unavailable_variants.length > 0) {
                variantsHtml += `<div class="unavailable-badge">${product.unavailable_variants.length} unavailable</div>`;
            }
        }
        
        const row = document.createElement('tr');
let baseStock = 0;
        if (product.variants) {
            const defaultVariant = product.variants.find(v => v.name === 'DEFAULT');
            baseStock = defaultVariant ? defaultVariant.stock : 0;
        } else {
            baseStock = totalStock; 
        }
        const stockButtonHTML = `<button class="action-btn base-stock-btn edit-stock-btn" onclick="openStockEdit('${product.name}', ${baseStock}, 'DEFAULT')">
                <i class="fas fa-box"></i> Base Stock: ${baseStock}
            </button>`;
        
        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.category}</td>
            <td class="price-cell">${pricesStr}</td>
            <td class="stock-cell ${stockClass}">${totalStock}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn edit-price-btn" onclick="openPriceEdit('${product.name}')">
                        <i class="fas fa-edit"></i> Price
                    </button>
                    ${stockButtonHTML}
                </div>
            </td>
        `;
        tbody.appendChild(row);
        
        
        if (variantsHtml) {
            const variantRow = document.createElement('tr');
            variantRow.className = 'variants-row';
            variantRow.innerHTML = `<td colspan="5">${variantsHtml}</td>`;
            tbody.appendChild(variantRow);
        }
    });
}

async function toggleAvailability(productName, variant) {
    try {
        const response = await fetch(`${API_URL}/toggle-variant-availability`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_name: productName, variant: variant })
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`${variant} is now ${data.status}!`);
            
            loadDashboardData(currentPeriod);
        } else {
            alert(data.message || 'Failed to toggle availability');
        }
    } catch (error) {
        console.error('Error toggling availability:', error);
        alert('Failed to toggle availability');
    }
}

async function openPriceEdit(productName) {
    editingProduct = productName;
    
    try {
        const response = await fetch(`${API_URL}/products`);
        const data = await response.json();
        if (data.success) {
            const product = data.products.find(p => p.name === productName);
            if (product) editingPrices = product.prices;
        }
    } catch (error) {
        console.error('Error fetching product prices:', error);
    }
    
    document.getElementById('edit-modal-title').textContent = 'Edit Price - ' + productName;
    document.getElementById('price-edit-form').style.display = 'block';
    document.getElementById('stock-edit-form').style.display = 'none';
    document.getElementById('edit-product-name').value = productName;
    
    const qtySelect = document.getElementById('edit-quantity');
    qtySelect.innerHTML = '';
    
    if (editingPrices) {
        Object.keys(editingPrices).forEach(qty => {
            const option = document.createElement('option');
            option.value = qty;
            option.textContent = `${qty} pcs - ${CURRENCY}${editingPrices[qty]}`;
            qtySelect.appendChild(option);
        });
        document.getElementById('edit-price-value').value = editingPrices[Object.keys(editingPrices)[0]];
    }
    
    document.getElementById('edit-modal').classList.add('active');
}

function openStockEdit(productName, currentStock, variant) {
    
    if (variant === undefined) {
        variant = 'DEFAULT';
    }
    
    document.getElementById('edit-modal-title').textContent = 'Edit Stock';
    document.getElementById('price-edit-form').style.display = 'none';
    document.getElementById('stock-edit-form').style.display = 'block';
    document.getElementById('edit-stock-product-name').value = productName;
    document.getElementById('edit-stock-variant-display').value = variant === 'DEFAULT' ? 'All Variants' : variant;
    document.getElementById('edit-current-stock').value = currentStock;
    document.getElementById('edit-stock-value').value = currentStock;
    document.getElementById('edit-stock-variant').value = variant;
    document.getElementById('edit-modal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

async function savePriceEdit() {
    const productName = editingProduct;
    const quantity = document.getElementById('edit-quantity').value;
    const newPrice = document.getElementById('edit-price-value').value;

    if (!newPrice || newPrice <= 0) {
        alert('Please enter a valid price');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/update-price`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_name: productName, quantity: quantity, new_price: newPrice })
        });
        const data = await response.json();

        if (data.success) {
            alert('Price updated successfully!');
            closeEditModal();
            loadDashboardData(currentPeriod);
            fetchProducts();
        } else {
            alert(data.message || 'Failed to update price');
        }
    } catch (error) {
        console.error('Error updating price:', error);
        alert('Failed to update price');
    }
}

async function saveStockEdit() {
    const productName = document.getElementById('edit-stock-product-name').value;
    const newStock = document.getElementById('edit-stock-value').value;
    const variant = document.getElementById('edit-stock-variant')?.value || 'DEFAULT';

    if (newStock === '' || newStock < 0) {
        alert('Please enter a valid stock value');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/update-stock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_name: productName, new_stock: newStock, variant: variant })
        });
        const data = await response.json();

        if (data.success) {
            alert('Stock updated successfully!');
            closeEditModal();
            loadDashboardData(currentPeriod);
        } else {
            alert(data.message || 'Failed to update stock');
        }
    } catch (error) {
        console.error('Error updating stock:', error);
        alert('Failed to update stock');
    }
}

function toggleChatbot() {
    const chatbot = document.getElementById('chatbot');
    if (chatbot) {
        chatbot.classList.toggle('active');
        
        // Load chat history when opening
        if (chatbot.classList.contains('active')) {
            loadChatHistory();
        }
    }
}

function handleChatKeypress(event) {
    if (event.key === 'Enter') sendChatMessage();
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    const messagesContainer = document.getElementById('chatbot-messages');
    const userMsg = document.createElement('div');
    userMsg.className = 'message user-message';
    userMsg.innerHTML = `<i class="fas fa-user"></i><p>${message}</p>`;
    messagesContainer.appendChild(userMsg);
    input.value = '';
    input.disabled = true;

    const typingMsg = document.createElement('div');
    typingMsg.className = 'message bot-message typing';
    typingMsg.innerHTML = `<i class="fas fa-robot"></i><p>Typing...</p>`;
    messagesContainer.appendChild(typingMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Get customer email if logged in
    const customerEmail = currentUser && currentUser.gmail ? currentUser.gmail : 'guest';

    fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: message, customer_email: customerEmail})
    })
    .then(res => res.json())
    .then(data => {
        messagesContainer.removeChild(typingMsg);
        const botMsg = document.createElement('div');
        botMsg.className = 'message bot-message';
        botMsg.innerHTML = `<i class="fas fa-robot"></i><p>${data.response || 'Sorry, try again!'}</p>`;
        messagesContainer.appendChild(botMsg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    })
    .catch(err => {
        messagesContainer.removeChild(typingMsg);
        const botMsg = document.createElement('div');
        botMsg.className = 'message bot-message';
        botMsg.innerHTML = `<i class="fas fa-robot"></i><p>Error connecting. Check if server is running.</p>`;
        messagesContainer.appendChild(botMsg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    })
    .finally(() => input.disabled = false);
}

function loadChatHistory() {
    const customerEmail = currentUser && currentUser.gmail ? currentUser.gmail : 'guest';
    const messagesContainer = document.getElementById('chatbot-messages');
    
    fetch('http://localhost:8000/get-chat-history', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({customer_email: customerEmail})
    })
    .then(res => res.json())
    .then(data => {
        if (data.success && data.messages && data.messages.length > 0) {
            // Clear existing messages
            messagesContainer.innerHTML = '';
            
            // Load each message
            data.messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                msgDiv.className = `message ${msg.type === 'bot' ? 'bot-message' : 'user-message'}`;
                const icon = msg.type === 'bot' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
                msgDiv.innerHTML = `${icon}<p>${msg.message}</p>`;
                messagesContainer.appendChild(msgDiv);
            });
            
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    })
    .catch(err => console.error('Error loading chat history:', err));
}

function getBotResponse(message) {
    const lower = message.toLowerCase();
    if (lower.includes('color') || lower.includes('ribbon')) return "We have 15 beautiful ribbon colors: MILKY WHITE, ROYAL BLUE, GOLDEN YELLOW, BARBIE PINK, LIGHT PURPLE, RED, BLACK, BROWN, DEEP ROSE RED, PEACH, WHITE, LIGHT PINK, LIGHT BLUE, YELLOW, and LIGHT GOLD!";
    if (lower.includes('donut') || lower.includes('flavor')) return "Our donuts come in amazing flavors! Classic: CHOCOLATE, WHITE CHOCOLATE, STRAWBERRY, MATCHA, and various with SPRINKLES, MALLOWS, or CRISP. Premium: ALMOND and OREO varieties!";
    if (lower.includes('flower') || lower.includes('bouquet')) return "We have Satin Ribbon Flowers, Lover Inspired Bouquets, Fuzzy Wire Bouquets, and Butterfly Bouquets! Each is handcrafted with love.";
    if (lower.includes('price') || lower.includes('cost')) return `Our products range from ${CURRENCY}60 for mini donuts to ${CURRENCY}849 for ribbon flower sets. Check our product pages for detailed pricing!`;
    if (lower.includes('order') || lower.includes('buy')) return "To order, simply browse our products, add items to cart, and checkout! You'll need to login with your Gmail first.";
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) return "Hello! Welcome to Juana's Ribbon! How can I help you today?";
    return "I'm here to help! Ask me about our ribbon colors, donut flavors, bouquets, prices, or how to place an order!";
}

function showImageModal() {
    document.getElementById('image-identify-modal').classList.add('active');
}

function closeImageModal() {
    document.getElementById('image-identify-modal').classList.remove('active');
    document.getElementById('upload-area').style.display = 'block';
    document.getElementById('image-preview').style.display = 'none';
    document.getElementById('identify-result').style.display = 'none';
    document.getElementById('image-upload').value = '';
}

function previewImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('preview-img').src = e.target.result;
            document.getElementById('upload-area').style.display = 'none';
            document.getElementById('image-preview').style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

async function identifyProduct() {
    const fileInput = document.getElementById('image-upload');
    const file = fileInput.files[0];

    if (!file) {
        alert('Please upload an image first');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);

    document.getElementById('identify-result').style.display = 'none';
    const resultText = document.getElementById('result-text');
    resultText.textContent = 'Analyzing image...';

    try {
        const response = await fetch(`${API_URL}/image-identify`, { method: 'POST', body: formData });
        const data = await response.json();

        let html = '';
        if (data.success) {
            // Perfect match found
            html = `<strong style="color: #4CAF50;">✓ Match Found!</strong><br/>
                    <strong>Product:</strong> ${data.detected}<br/>
                    <strong>Confidence:</strong> ${data.confidence}`;
        } else if (data.detected && data.detected.includes('unclear')) {
            // Weak/uncertain match
            html = `<strong style="color: #FF9800;">⚠ Uncertain Match</strong><br/>
                    <strong>Closest:</strong> ${data.closest || 'Unknown'}<br/>
                    <em>${data.message || 'Try a different photo angle'}</em>`;
        } else if (data.detected && (data.detected.includes('not found') || data.detected.includes('not recognized'))) {
            // Not in catalog
            html = `<strong style="color: #F44336;">✗ Not in Catalog</strong><br/>
                    <em>${data.message || 'This product is not in our system'}</em>`;
        } else {
            // Generic no match
            html = `<strong style="color: #FF9800;">No Match</strong><br/>
                    <strong>Closest:</strong> ${data.closest || 'Unknown'}<br/>
                    <em>${data.message || 'Try uploading a clearer photo'}</em>`;
        }
        
        resultText.innerHTML = html;
        document.getElementById('identify-result').style.display = 'block';
    } catch (error) {
        console.error('Error:', error);
        resultText.innerHTML = '<strong style="color: #F44336;">Error analyzing image</strong><br/><em>Please try again</em>';
        document.getElementById('identify-result').style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.onclick = showLoginModal;
        console.log(' Login button handler attached!');
    }
    
    const customerBtns = document.querySelectorAll('.customer-only');
    customerBtns.forEach(btn => btn.style.display = currentUser ? 'flex' : 'none');
    
    fetchProducts();
});

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
};

let currentCancelOrderId = null;

function getOrderActions(order) {
    console.log('Order status:', order.status, 'Payment:', order.payment);
    let actions = '';
    if (order.status === 'pending' || order.status === 'scheduled') {
        actions += `<button class="simple-action-btn payment-btn" onclick="updateSimpleOrderStatus('${order.order_id}', 'payment_confirmed')">
            <i class="fas fa-credit-card"></i> Confirm Payment
        </button>`;
    }
    
    if (order.status === 'payment_confirmed') {
        actions += `<button class="simple-action-btn production-btn" onclick="updateSimpleOrderStatus('${order.order_id}', 'production')">
            <i class="fas fa-cogs"></i> Start Production
        </button>`;
    }

    if (order.status === 'production') {
        actions += `<button class="simple-action-btn done-btn" onclick="updateSimpleOrderStatus('${order.order_id}', 'done')">
            <i class="fas fa-check-double"></i> Mark Done
        </button>`;
    }

    if (order.status === 'done') {
        actions += `<button class="simple-action-btn delivered-btn" onclick="updateSimpleOrderStatus('${order.order_id}', 'delivered')">
            <i class="fas fa-truck"></i> Delivered
        </button>`;
    }

    if (order.status !== 'cancelled' && order.status !== 'delivered') {
        actions += `<button class="simple-action-btn cancel-btn" onclick="showCancelReasonModal('${order.order_id}')">
            <i class="fas fa-times"></i> Cancel Order
        </button>`;
    }

    return actions || '<span class="no-actions">No actions needed</span>';
}

async function loadSimpleOrderManagement() {
    const tbody = document.getElementById('simple-order-management-body');
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading orders... <i class="fas fa-spinner fa-spin"></i></td></tr>';

    try {
        const response = await fetch(`${API_URL}/get-all-orders`);
        const data = await response.json();

        if (data.success && data.orders && data.orders.length > 0) {
            tbody.innerHTML = '';
            data.orders.forEach(order => {
                const statusBadge = getStatusBadge(order.status);
                const paymentBadge = getPaymentBadge(order.payment);
                const itemsDetails = formatOrderItemsDetails(order.items);
                const date = new Date(order.created_at).toLocaleDateString();

                const actions = getOrderActions(order);

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${order.order_id}</strong></td>
                    <td>${order.customer_gmail}</td>
                    <td title="${itemsDetails}">${itemsDetails}</td>
                    <td>${CURRENCY}${order.total}</td>
                    <td>${paymentBadge}</td>
                    <td>${statusBadge}</td>
                    <td>${date}</td>
                    <td>${actions}</td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="8" class="no-orders">No orders found</td></tr>';
        }
    } catch (error) {
        console.error('Error loading simple orders:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="error">Error loading orders</td></tr>';
    }
}

function getPaymentBadge(payment) {
    const badges = {
        'gcash': '<span class="status-badge payment-gcash">GCash</span>',
        'cash': '<span class="status-badge payment-cash">Cash</span>',
        '': '<span class="status-badge payment-unknown">Unknown</span>'
    };
    return badges[payment] || badges[''];
}

function getStatusBadge(status) {
    const badges = {
        'pending': '<span class="status-badge status-pending">Pending</span>',
        'payment_pending': '<span class="status-badge status-payment-pending">Payment Pending</span>',
        'payment_confirmed': '<span class="status-badge status-payment-confirmed">Confirmed</span>',
        'production': '<span class="status-badge status-production">Production</span>',
        'done': '<span class="status-badge status-done">Done</span>',
        'delivered': '<span class="status-badge status-delivered">Delivered</span>',
        'cancelled': '<span class="status-badge status-cancelled">Cancelled</span>'
    };
    return badges[status] || '<span class="status-badge status-unknown">Unknown</span>';
}

async function updateSimpleOrderStatus(orderId, status) {
    try {
        const response = await fetch(`${API_URL}/update-order-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, status })
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`Order ${status.replace('_', ' ')} successfully!`);
            loadSimpleOrderManagement();
        } else {
            alert('Failed to update status');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error updating status');
    }
}

// Return/Refund Management for Owner
async function loadReturnRefundManagement() {
    const tbody = document.getElementById('return-requests-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading return requests... <i class="fas fa-spinner fa-spin"></i></td></tr>';

    try {
        const response = await fetch(`${API_URL}/get-return-requests`);
        const data = await response.json();

        if (data.success && data.return_requests && data.return_requests.length > 0) {
            tbody.innerHTML = '';
            data.return_requests.forEach(req => {
                const statusBadge = getReturnStatusBadge(req.status);
                const date = req.formatted_date || 'N/A';

                const actionButtons = getReturnActions(req);

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${req.order_id}</strong></td>
                    <td>${req.customer_gmail}</td>
                    <td>${req.reason_1}</td>
                    <td>${req.reason_2}</td>
                    <td>${statusBadge}</td>
                    <td>${date}</td>
                    <td>${actionButtons}</td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="no-requests">No return/refund requests found</td></tr>';
        }
    } catch (error) {
        console.error('Error loading return requests:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="error">Error loading return requests</td></tr>';
    }
}

function getReturnStatusBadge(status) {
    const badges = {
        'pending': '<span class="status-badge status-pending">Pending Review</span>',
        'approved': '<span class="status-badge status-done">Approved</span>',
        'disapproved': '<span class="status-badge status-cancelled">Disapproved</span>'
    };
    return badges[status] || '<span class="status-badge status-unknown">Unknown</span>';
}

function getReturnActions(req) {
    if (req.status === 'pending') {
        return `
            <button class="simple-action-btn approve-btn" onclick="approveReturnRequest('${req.order_id}')" title="Approve">
                <i class="fas fa-check"></i> Approve
            </button>
            <button class="simple-action-btn disapprove-btn" onclick="showDisapproveReturnModal('${req.order_id}')" title="Disapprove">
                <i class="fas fa-times"></i> Disapprove
            </button>
        `;
    } else if (req.status === 'approved') {
        return '<span class="action-status approved-status"><i class="fas fa-check-circle"></i> Approved</span>';
    } else if (req.status === 'disapproved') {
        return '<span class="action-status disapproved-status"><i class="fas fa-times-circle"></i> Disapproved</span>';
    }
    return '';
}

async function approveReturnRequest(orderId) {
    if (!confirm(`Approve return request for order ${orderId}?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/approve-return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Return request approved successfully!');
            loadReturnRefundManagement();
            // Refresh sales calculation
            if (typeof changePeriod === 'function') {
                changePeriod(currentPeriod);
            }
            // Notify customer of approval
            setTimeout(() => fetchNotifications(), 500);
        } else {
            alert(data.message || 'Failed to approve return request');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error approving return request');
    }
}

function showDisapproveReturnModal(orderId) {
    const reason = prompt('Please provide a reason for disapproving this return request:');
    if (reason !== null && reason.trim() !== '') {
        disapproveReturnRequest(orderId, reason);
    }
}

async function disapproveReturnRequest(orderId, reason) {
    try {
        const response = await fetch(`${API_URL}/disapprove-return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                order_id: orderId,
                reason: reason
            })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Return request disapproved.');
            loadReturnRefundManagement();
            // Notify customer of disapproval
            setTimeout(() => fetchNotifications(), 500);
        } else {
            alert(data.message || 'Failed to disapprove return request');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error disapproving return request');
    }
}

function showCancelReasonModal(orderId) {
    currentCancelOrderId = orderId;
    document.getElementById('cancel-reason-text').value = '';
    document.getElementById('cancel-reason-modal').classList.add('active');
}

function closeCancelReasonModal() {
    document.getElementById('cancel-reason-modal').classList.remove('active');
}

async function confirmCancelOrder() {
    const reason = document.getElementById('cancel-reason-text').value.trim();
    if (!reason) return alert('Enter reason');

    try {
        const response = await fetch(`${API_URL}/update-order-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                order_id: currentCancelOrderId, 
                status: 'cancelled', 
                cancel_reason: reason 
            })
        });
        const data = await response.json();
        
        if (data.success) {
            closeCancelReasonModal();
            document.getElementById('cancel-reason-text').value = '';
            loadSimpleOrderManagement();
            alert('Order cancelled successfully!');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error cancelling order');
    }
}

async function markOrderReceived(orderId) {
    if (!confirm('Confirm that you have received this order?')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/update-order-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                order_id: orderId, 
                status: 'delivered'
            })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Order marked as received successfully!');
            loadCustomerOrders();
            // Refresh notifications for owner to see the received confirmation
            if (currentUser && currentUser.role === 'customer') {
                setTimeout(() => fetchNotifications(), 500);
            }
        } else {
            alert(data.message || 'Failed to mark order as received');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error marking order as received');
    }
}

// Return/Refund Request Functions
let currentReturnOrderId = null;

function openReturnRequestModal(orderId) {
    currentReturnOrderId = orderId;
    // Reset form
    document.getElementById('return-reason-1').value = '';
    document.getElementById('return-reason-2').value = '';
    document.getElementById('return-details').value = '';
    document.getElementById('return-request-modal').classList.add('active');
}

function closeReturnRequestModal() {
    document.getElementById('return-request-modal').classList.remove('active');
    currentReturnOrderId = null;
}

async function submitReturnRequest() {
    const reason1 = document.getElementById('return-reason-1').value.trim();
    const reason2 = document.getElementById('return-reason-2').value.trim();
    
    if (!reason1 || !reason2) {
        alert('Please select both reasons');
        return;
    }
    
    if (reason1 === reason2) {
        alert('Please select two different reasons');
        return;
    }
    
    if (!currentUser || !currentUser.gmail) {
        alert('User not logged in');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/request-return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: currentReturnOrderId,
                customer_gmail: currentUser.gmail,
                reason_1: reason1,
                reason_2: reason2
            })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Return request submitted successfully! The owner will review it shortly.');
            closeReturnRequestModal();
            loadCustomerOrders();
            // Reload to show updated return/refund status
            setTimeout(() => filterOrdersByStatus('return'), 500);
            // Notify owner of the new return request
            setTimeout(() => fetchNotifications(), 1000);
        } else {
            alert(data.message || 'Failed to submit return request');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error submitting return request');
    }
}

async function displayReturnRequests() {
    const listView = document.getElementById('orders-list-view');
    
    if (!currentUser || !currentUser.gmail) {
        listView.innerHTML = '<div class="error-message">Please log in to view return requests</div>';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/get-customer-return-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_gmail: currentUser.gmail })
        });
        const data = await response.json();
        
        if (data.success && data.return_requests && data.return_requests.length > 0) {
            // Update return count
            const returnCount = document.getElementById('return-count');
            if (returnCount) {
                returnCount.textContent = data.return_requests.length;
            }
            
            listView.innerHTML = '';
            data.return_requests.forEach(req => {
                const returnCard = createReturnRequestCard(req);
                listView.appendChild(returnCard);
            });
        } else {
            // Update return count
            const returnCount = document.getElementById('return-count');
            if (returnCount) {
                returnCount.textContent = 0;
            }
            
            listView.innerHTML = `
                <div class="no-orders-message">
                    <i class="fas fa-redo"></i>
                    <p>No return/refund requests yet</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading return requests:', error);
        listView.innerHTML = '<div class="error-message"><i class="fas fa-exclamation-circle"></i> Error loading return requests</div>';
    }
}

function createReturnRequestCard(req) {
    const card = document.createElement('div');
    card.className = 'order-card';
    
    let statusBadge = '';
    let statusColor = '';
    if (req.status === 'pending') {
        statusBadge = '<span class="status-badge status-pending">Pending Review</span>';
        statusColor = '#ff9800';
    } else if (req.status === 'approved') {
        statusBadge = '<span class="status-badge status-done">Approved</span>';
        statusColor = '#4caf50';
    } else if (req.status === 'disapproved') {
        statusBadge = '<span class="status-badge status-cancelled">Disapproved</span>';
        statusColor = '#f44336';
    }
    
    let statusInfo = '';
    if (req.status === 'approved') {
        statusInfo = `<p style="color: #4caf50; font-weight: 500;">✓ Your return request has been approved</p>`;
    } else if (req.status === 'disapproved') {
        statusInfo = `<p style="color: #f44336; font-weight: 500;">✗ Return request was not approved</p>`;
        if (req.notes) {
            statusInfo += `<p style="color: #666; font-size: 14px;">Reason: ${req.notes}</p>`;
        }
    } else {
        statusInfo = `<p style="color: #666;">Awaiting owner review...</p>`;
    }
    
    card.innerHTML = `
        <div class="order-card-header">
            <div class="order-id-date">
                <h4 class="order-id">Return Request for #${req.order_id}</h4>
                <span class="order-date">${req.formatted_date || 'N/A'}</span>
            </div>
            <div class="order-badge">
                ${statusBadge}
            </div>
        </div>
        <div class="order-card-body">
            <div class="return-details">
                <p class="return-label">Reasons:</p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>${req.reason_1}</li>
                    <li>${req.reason_2}</li>
                </ul>
            </div>
            <div class="return-status">
                ${statusInfo}
            </div>
        </div>
    `;
    
    return card;
}

function initCheckout() {
    checkoutStep = 1;
    
    const calculateSubtotal = () => cart.reduce((sum, item) => {
        return sum + (item.is_bundle ? item.total_price : item.price);
    }, 0);
}


let checkoutStep = 1;

function resetCheckoutModal() {
    checkoutData = {
        method: null,
        address: '',
        date: '',
        time: '',
        payment: null,
        subtotal: 0,
        deliveryFee: 0,
        total: 0
    };
    
    checkoutStep = 1;
    const deliveryMethodRadios = document.querySelectorAll('input[name="delivery-method"]');
    deliveryMethodRadios.forEach(radio => { if (radio) radio.checked = false; });
    
    const paymentMethodRadios = document.querySelectorAll('input[name="payment-method"]');
    paymentMethodRadios.forEach(radio => { if (radio) radio.checked = false; });
    
    const deliveryAddress = document.getElementById('delivery-address');
    if (deliveryAddress) deliveryAddress.value = '';
    
    const orderDate = document.getElementById('order-date');
    if (orderDate) orderDate.value = '';
    
    const orderTime = document.getElementById('order-time');
    if (orderTime) orderTime.value = '';
    
    const orderDatePickup = document.getElementById('order-date-pickup');
    if (orderDatePickup) orderDatePickup.value = '';
    
    const orderTimePickup = document.getElementById('order-time-pickup');
    if (orderTimePickup) orderTimePickup.value = '';

    const receiptContainer = document.querySelector('.receipt-container');
    if (receiptContainer) {
        
        const itemsList = document.getElementById('receipt-items-list');
        if (itemsList) itemsList.innerHTML = '';
    }
    
    const methodNextBtn = document.getElementById('method-next-btn');
    if (methodNextBtn) methodNextBtn.disabled = true;
    
    const detailsNextBtn = document.getElementById('details-next-btn');
    if (detailsNextBtn) detailsNextBtn.disabled = true;
    
    const paymentNextBtn = document.getElementById('payment-next-btn');
    if (paymentNextBtn) paymentNextBtn.disabled = true;
    
    const deliveryDetails = document.getElementById('delivery-details');
    if (deliveryDetails) deliveryDetails.style.display = 'none';
    
    const pickupDetails = document.getElementById('pickup-details');
    if (pickupDetails) pickupDetails.style.display = 'none';
    
    const gcashQrSection = document.getElementById('gcash-qr-section');
    if (gcashQrSection) gcashQrSection.style.display = 'none';
    
    const checkoutDeliveryFeeLine = document.getElementById('checkout-delivery-fee-line');
    if (checkoutDeliveryFeeLine) checkoutDeliveryFeeLine.style.display = 'none';
    
    const receiptDeliveryFeeLine = document.getElementById('receipt-delivery-fee-line');
    if (receiptDeliveryFeeLine) receiptDeliveryFeeLine.style.display = 'none';
    
    const receiptDeliveryInfo = document.getElementById('receipt-delivery-info');
    if (receiptDeliveryInfo) receiptDeliveryInfo.style.display = 'none';
    
    document.querySelectorAll('.checkout-step-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.checkout-step').forEach(el => el.classList.remove('active', 'completed'));
    
    const checkoutStep1 = document.getElementById('checkout-step-1');
    if (checkoutStep1) checkoutStep1.classList.add('active');
    
    if (typeof updateCheckoutSteps === 'function') {
        updateCheckoutSteps(1);
    }
}

function initCheckout() {
    resetCheckoutModal();
    
    const calculateSubtotal = () => cart.reduce((sum, item) => {
        return sum + (item.is_bundle ? item.total_price : item.price);
    }, 0);
    
    checkoutData.subtotal = calculateSubtotal();
    checkoutData.total = calculateSubtotal();
    
    addValidationListeners();
}

function addValidationListeners() {
    
    const deliveryAddress = document.getElementById('delivery-address');
    const deliveryTime = document.getElementById('order-time');
    const pickupTime = document.getElementById('order-time-pickup');
    
    if (deliveryAddress) {
        deliveryAddress.oninput = validateStep2;
    }
    if (deliveryTime) {
        deliveryTime.onchange = validateStep2;
    }
    if (pickupTime) {
        pickupTime.onchange = validateStep2;
    }
}

function validateStep2() {
    const btn = document.getElementById('details-next-btn');
    if (!checkoutData.method) {
        btn.disabled = true;
        return;
    }
    
    if (checkoutData.method === 'delivery') {
        const address = document.getElementById('delivery-address').value.trim();
        const time = document.getElementById('order-time').value;
        btn.disabled = !(address.length > 10 && time);
    } else {
        const time = document.getElementById('order-time-pickup').value;
        btn.disabled = !time;
    }
}

function selectDeliveryMethod(method) {
    checkoutData.method = method;
    document.getElementById('method-next-btn').disabled = false;
    
    if (method === 'delivery') {
        document.getElementById('delivery-details').style.display = 'block';
        document.getElementById('pickup-details').style.display = 'none';
        checkoutData.deliveryFee = DELIVERY_FEE;
    } else {
        document.getElementById('delivery-details').style.display = 'none';
        document.getElementById('pickup-details').style.display = 'block';
        checkoutData.deliveryFee = 0;
    }
    
    updateCheckoutTotals();
    
    document.getElementById('details-next-btn').disabled = true;
}

function updateCheckoutTotals() {
    checkoutData.subtotal = cart.reduce((sum, item) => {
        return sum + (item.is_bundle ? item.total_price : item.price);
    }, 0);
    checkoutData.total = checkoutData.subtotal + checkoutData.deliveryFee;
    
    document.getElementById('checkout-subtotal').textContent = `${CURRENCY}${checkoutData.subtotal}`;
    document.getElementById('checkout-delivery-fee').textContent = `${CURRENCY}${checkoutData.deliveryFee}`;
    document.getElementById('checkout-total').textContent = `${CURRENCY}${checkoutData.total}`;
    
    if (checkoutData.method === 'delivery') {
        document.getElementById('checkout-delivery-fee-line').style.display = 'flex';
    } else {
        document.getElementById('checkout-delivery-fee-line').style.display = 'none';
    }
}

function goToCheckoutStep2() {
    
    if (!checkoutData.method) {
        alert('Please select a delivery method');
        return;
    }
    
    
    const cartItemsContainer = document.getElementById('checkout-cart-items');
    cartItemsContainer.innerHTML = '';
    
    cart.forEach(item => {
        const div = document.createElement('div');
        div.className = 'checkout-cart-item';
        
        if (item.is_bundle) {
            div.innerHTML = `
                <div class="checkout-bundle-item">
                    <span><i class="fas fa-gift"></i> ${item.details}</span>
                    <span>₱${item.total_price}</span>
                </div>
                ${item.items.map(bundleItem => `
                    <div class="checkout-bundle-product" style="padding-left:20px;font-size:0.9em;">
                        <span>${bundleItem.name} - ${bundleItem.details}</span>
                        <span>₱${bundleItem.price}</span>
                    </div>
                `).join('')}
            `;
        } else {
            div.innerHTML = `
                <span>${item.name} (${item.details})</span>
                <span>${CURRENCY}${item.price}</span>
            `;
        }
        cartItemsContainer.appendChild(div);
    });
    
    updateCheckoutTotals();
    showCheckoutStep(2);
}

function goToCheckoutStep1() {
    showCheckoutStep(1);
}

function goToCheckoutStep3() {
    
    if (checkoutData.method === 'delivery') {
        checkoutData.address = document.getElementById('delivery-address').value.trim();
        checkoutData.date = document.getElementById('order-date').value;
        checkoutData.time = document.getElementById('order-time').value;
        
        if (!checkoutData.address) {
            alert('Please enter your delivery address');
            return;
        }
        
        if (!checkoutData.date || !checkoutData.time) {
            alert('Please select a date and time');
            return;
        }
    } else {
        checkoutData.address = '';
        checkoutData.date = document.getElementById('order-date-pickup').value;
        checkoutData.time = document.getElementById('order-time-pickup').value;
        
        if (!checkoutData.date || !checkoutData.time) {
            alert('Please select a date and time');
            return;
        }
    }
    
    showCheckoutStep(3);
}

function selectPaymentMethod(payment) {
    checkoutData.payment = payment;
    document.getElementById('payment-next-btn').disabled = false;
    
    if (payment === 'gcash') {
        document.getElementById('gcash-qr-section').style.display = 'block';
        document.getElementById('gcash-amount').textContent = `${CURRENCY}${checkoutData.total}`;
    } else {
        document.getElementById('gcash-qr-section').style.display = 'none';
    }
}

async function processOrder() {
    if (!checkoutData.payment) {
        alert('Please select a payment method');
        return;
    }
    
    
    const order = {
        customer_gmail: currentUser.gmail,
        items: cart.map(item => {
            if (item.is_bundle) {
                return item.items.map(bundleItem => ({
                    name: bundleItem.name,
                    quantity: bundleItem.quantity,
                    variant: bundleItem.color || bundleItem.flavor || 'DEFAULT',
                    color: bundleItem.color || '',
                    flavor: bundleItem.flavor || '',
                    price: bundleItem.price,
                    is_bundle_item: true,
                    bundle_id: item.bundle_id
                }));
            } else {
                return {
                    name: item.name,
                    quantity: item.quantity || 1,
                    variant: item.color || item.flavor || 'DEFAULT',
                    color: item.color || '',
                    flavor: item.flavor || '',
                    price: item.price
                };
            }
        }).flat(),
        subtotal: checkoutData.subtotal,
        delivery_fee: checkoutData.deliveryFee,
        total: checkoutData.total,
        method: checkoutData.method,
        address: checkoutData.address,
        date: checkoutData.date,
        time: checkoutData.time,
        payment: checkoutData.payment
    };
    
    try {
        const response = await fetch(`${API_URL}/calendar-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
        });
        const data = await response.json();
        
        if (data.success) {
            window.lastOrderId = data.order_id;  
            console.log('Order placed:', data.order_id);
            showCheckoutStep(4);
            robustPopulateReceipt(data.order_id);
        } else {
            alert(data.message || 'Failed to place order.');
            showCheckoutStep(4);
            window.lastOrderId = '#' + Math.floor(1000 + Math.random() * 9000);
            setTimeout(() => robustPopulateReceipt(window.lastOrderId), 300);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Order simulated for demo.');
        showCheckoutStep(4);
        window.lastOrderId = '#' + Math.floor(1000 + Math.random() * 9000);
        setTimeout(() => robustPopulateReceipt(window.lastOrderId), 300);
    }
}

async function robustPopulateReceipt(order_id) {
    try {
        const response = await fetch(`${API_URL}/generate-receipt`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({order_id: order_id})
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.success) {
            populateCheckoutReceipt(data);
        } else {
            console.error('Receipt error:', data.message);
            robustPopulateReceiptFromLocalData(order_id);
        }
    } catch (error) {
        console.error('Receipt fetch error:', error);
        robustPopulateReceiptFromLocalData(order_id); 
    }
}

function populateCheckoutReceipt(data) {
    console.log('populateCheckoutReceipt called with data:', data);
    
    const safeSetText = (selector, value) => {
        const el = document.getElementById(selector);
        console.log(`Setting ${selector}:`, value, 'Element:', el);
        if (el) el.textContent = value || '';
    };
    
    safeSetText('receipt-order-id', data.order_id);
    safeSetText('receipt-date', data.date);
    safeSetText('receipt-customer', data.customer);
    safeSetText('receipt-subtotal', `${CURRENCY}${data.subtotal || 0}`);
    safeSetText('receipt-delivery-fee', `${CURRENCY}${data.delivery_fee || 0}`);
    safeSetText('receipt-total', `${CURRENCY}${data.total || 0}`);
    safeSetText('receipt-payment', (data.payment || 'CASH').toUpperCase());
    safeSetText('receipt-address', data.address || 'N/A');
    safeSetText('receipt-time', data.time || 'N/A');
    
    const itemsList = document.getElementById('receipt-items-list');
    console.log('Items list element:', itemsList);
    if (itemsList) {
        itemsList.innerHTML = '';
        (data.items || []).forEach(item => {
            const div = document.createElement('div');
            div.className = 'receipt-item';
            let itemDisplay = item.name;
            
            // Include variant details (colors, flavors, quantity, add-ons)
            if (item.details) {
                itemDisplay += ` (${item.details})`;
            } else if (item.color || item.flavor) {
                itemDisplay += ` - ${item.color || item.flavor}`;
                if (item.quantity) {
                    itemDisplay += ` x${item.quantity}`;
                }
            }
            
            div.innerHTML = `
                <span class="receipt-item-name">${itemDisplay || 'Item'}</span>
                <span class="receipt-item-price">${CURRENCY}${item.price || 0}</span>
            `;
            itemsList.appendChild(div);
        });
    }
    
    const deliveryFeeLine = document.getElementById('receipt-delivery-fee-line');
    if (deliveryFeeLine) {
        deliveryFeeLine.style.display = (data.delivery_fee || 0) > 0 ? 'flex' : 'none';
    }
    
    const deliveryInfo = document.getElementById('receipt-delivery-info');
    if (deliveryInfo) {
        deliveryInfo.style.display = data.address && data.address !== 'N/A' ? 'block' : 'none';
    }
    
    const timeInfo = document.getElementById('receipt-time-info');
    if (timeInfo) {
        timeInfo.style.display = data.time && data.time !== 'N/A' ? 'block' : 'none';
    }
    
    console.log('Checkout receipt populated:', data.order_id);
}

function robustPopulateReceiptFromLocalData(order_id) {
    const mockData = {
        order_id: order_id,
        date: new Date().toLocaleString(),
        customer: currentUser?.gmail || 'Customer',
        items: cart.map(item => ({
            name: item.name,
            details: item.details,
            color: item.color,
            flavor: item.flavor,
            quantity: item.quantity,
            price: item.price
        })),
        subtotal: checkoutData.subtotal || 0,
        delivery_fee: checkoutData.deliveryFee || 0,
        total: checkoutData.total || 0,
        payment: checkoutData.payment || 'CASH',
        address: checkoutData.address || '',
        time: checkoutData.time || ''
    };
    
    populateCheckoutReceipt(mockData);
}

function robustPopulateReceiptFromData(data) {
    const receiptType = data.receipt_type || 'checkout';
    const prefix = receiptType === 'customer' ? 'customer-receipt-' : 'receipt-';
    
    const safeSetText = (selector, value) => {
        const el = document.getElementById(prefix + selector);
        if (el) el.textContent = value || '';
    };
    
    const safeToggleDisplay = (selector, condition) => {
        const el = document.getElementById(prefix + selector);
        if (el) el.style.display = condition ? 'flex' : 'none';
    };
    
    safeSetText('order-id', data.order_id);
    safeSetText('date', data.date);
    safeSetText('customer', data.customer);
    
    const itemsList = document.getElementById('receipt-items-list');
    if (itemsList) {
        itemsList.innerHTML = '';
        (data.items || []).forEach(item => {
            const div = document.createElement('div');
            div.className = 'receipt-item';
            let itemDisplay = item.name;
            
            // Include variant details (colors, flavors, quantity, add-ons)
            if (item.details) {
                itemDisplay += ` (${item.details})`;
            } else if (item.color || item.flavor) {
                itemDisplay += ` - ${item.color || item.flavor}`;
                if (item.quantity) {
                    itemDisplay += ` x${item.quantity}`;
                }
            }
            
            div.innerHTML = `
                <span class="receipt-item-name">${itemDisplay || 'Item'}</span>
                <span class="receipt-item-price">${CURRENCY}${item.price || 0}</span>
            `;
            itemsList.appendChild(div);
        });
    }
    
    safeSetText('receipt-subtotal', `${CURRENCY}${data.subtotal || 0}`);
    safeSetText('receipt-delivery-fee', `${CURRENCY}${data.delivery_fee || 0}`);
    safeSetText('receipt-total', `${CURRENCY}${data.total || 0}`);
    safeSetText('receipt-payment', (data.payment || 'CASH').toUpperCase());
    safeSetText('receipt-address', data.address || '');
    safeSetText('receipt-time', data.time || '');
    
    safeToggleDisplay('receipt-delivery-fee-line', (data.delivery_fee || 0) > 0);
    safeToggleDisplay('receipt-delivery-info', !!data.address);
    
    console.log('Receipt populated successfully:', data.order_id);
}

function populateReceiptFromLocalData(order_id, date) {
    const orderIdEl = document.getElementById('receipt-order-id');
    const dateEl = document.getElementById('receipt-date');
    const customerEl = document.getElementById('receipt-customer');
    
    orderIdEl.textContent = order_id;
    dateEl.textContent = date;
    customerEl.textContent = currentUser.gmail;
    
    const itemsList = document.getElementById('receipt-items-list');
    itemsList.innerHTML = '';
    
    if (cart.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'receipt-item';
        emptyDiv.innerHTML = '<span>No items in cart</span>';
        itemsList.appendChild(emptyDiv);
        return;
    }
    
    cart.forEach(item => {
        const div = document.createElement('div');
        
        if (item.is_bundle && item.items) {
            div.className = 'receipt-bundle';
            div.innerHTML = `
                <div class="receipt-bundle-header">
                    <i class="fas fa-gift"></i> ${item.details || 'Bundle'}
                </div>
                ${item.items.map(bundleItem => `
                    <div class="bundle-product-item">
                        <span>${bundleItem.name} - ${bundleItem.details || ''}</span>
                        <span>${CURRENCY}${bundleItem.price || 0}</span>
                    </div>
                `).join('')}
                <div class="bundle-item-price" style="text-align:right;margin-top:5px;">
                    <strong>Bundle Total: ${CURRENCY}${item.total_price || 0}</strong>
                </div>
            `;
        } else {
            div.className = 'receipt-item';
            div.innerHTML = `
                <span class="receipt-item-name">${item.name} (${item.details || 'No details'})</span>
                <span class="receipt-item-price">${CURRENCY}${item.price || 0}</span>
            `;
        }
        
        itemsList.appendChild(div);
    });
    
    const subtotalEl = document.getElementById('receipt-subtotal');
    const totalEl = document.getElementById('receipt-total');
    const paymentEl = document.getElementById('receipt-payment');
    
    if (subtotalEl) subtotalEl.textContent = `${CURRENCY}${checkoutData.subtotal}`;
    if (totalEl) totalEl.textContent = `${CURRENCY}${checkoutData.total}`;
    if (paymentEl) paymentEl.textContent = checkoutData.payment?.toUpperCase() || 'CASH';
}


function printReceipt() {
    window.print();
}

function finishOrder() {
    cart = [];
    updateCartBadge();
    saveCart(); 
    resetCheckoutModal();
    closeCheckoutModal();
    showPage('order-status');
    
    alert(`Order placed successfully! Order #${window.lastOrderId || 'N/A'}. Check your order status.`);
}

function showCheckoutStep(step) {
    console.log('showCheckoutStep called with:', step);
    
    document.querySelectorAll('.checkout-step-content').forEach(el => {
        console.log('Removing active from:', el.id);
        el.classList.remove('active');
    });
    document.querySelectorAll('.checkout-step').forEach(el => el.classList.remove('active'));
    
    const targetElement = document.getElementById(`checkout-step-${step}`);
    console.log('Target element:', targetElement);
    
    if (targetElement) {
        targetElement.classList.add('active');
        console.log('Added active class to:', targetElement.id);
    } else {
        console.error('Element not found:', `checkout-step-${step}`);
    }
    
    updateCheckoutSteps(step);
}

function updateCheckoutSteps(currentStep) {
    document.querySelectorAll('.checkout-step').forEach((el, index) => {
        if (index + 1 < currentStep) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (index + 1 === currentStep) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });
}

function closeCheckoutModal() {
    document.getElementById('checkout-modal').classList.remove('active');
}

function checkout() {
    if (!currentUser) {
        alert('Please login to checkout');
        showLoginModal();
        return;
    }
    
    if (cart.length === 0) {
        alert('Your cart is empty');
        return;
    }
    
    closeCheckoutModal();
    
    resetCheckoutModal();
    initCheckout();
    
    const checkoutModal = document.getElementById('checkout-modal');
    if (checkoutModal) {
        checkoutModal.classList.add('active');
    }
}
async function loadAvailableSlots() {
    const date = document.getElementById('order-date').value;
    if (!date) return;
    
    const timeSelect = document.getElementById('order-time');
    timeSelect.innerHTML = '<option value="">Loading...</option>';
    
    try {
        const response = await fetch(`${API_URL}/available-slots?date=${date}`);
        const data = await response.json();
        
        timeSelect.innerHTML = '<option value="">Select time</option>';
        
        if (data.success && data.slots) {
            data.slots.forEach(slot => {
                const option = document.createElement('option');
                option.value = slot.time;
                if (slot.available) {
                    option.textContent = slot.time;
                } else {
                    option.textContent = `${slot.time} (Full)`;
                    option.disabled = true;
                }
                timeSelect.appendChild(option);
            });
        } else {
            for (let h = 9; h < 20; h++) {
                const option = document.createElement('option');
                option.value = `${h.toString().padStart(2, '0')}:00`;
                option.textContent = `${h.toString().padStart(2, '0')}:00`;
                timeSelect.appendChild(option);
            }
        }
        
        timeSelect.onchange = validateStep2;
    } catch (error) {
        console.error('Error loading slots:', error);
        timeSelect.innerHTML = '';
        for (let h = 9; h < 20; h++) {
            const option = document.createElement('option');
            option.value = `${h.toString().padStart(2, '0')}:00`;
            option.textContent = `${h.toString().padStart(2, '0')}:00`;
            timeSelect.appendChild(option);
        }
        timeSelect.onchange = validateStep2;
    }
}

async function loadAvailableSlotsPickup() {
    const date = document.getElementById('order-date-pickup').value;
    if (!date) return;
    
    const timeSelect = document.getElementById('order-time-pickup');
    timeSelect.innerHTML = '<option value="">Loading...</option>';
    
    try {
        const response = await fetch(`${API_URL}/available-slots?date=${date}`);
        const data = await response.json();
        
        timeSelect.innerHTML = '<option value="">Select time</option>';
        
        if (data.success && data.slots) {
            data.slots.forEach(slot => {
                const option = document.createElement('option');
                option.value = slot.time;
                if (slot.available) {
                    option.textContent = slot.time;
                } else {
                    option.textContent = `${slot.time} (Full)`;
                    option.disabled = true;
                }
                timeSelect.appendChild(option);
            });
        } else {
            for (let h = 9; h < 20; h++) {
                const option = document.createElement('option');
                option.value = `${h.toString().padStart(2, '0')}:00`;
                option.textContent = `${h.toString().padStart(2, '0')}:00`;
                timeSelect.appendChild(option);
            }
        }
        
        timeSelect.onchange = validateStep2;
    } catch (error) {
        console.error('Error loading slots:', error);
        timeSelect.innerHTML = '';
        for (let h = 9; h < 20; h++) {
            const option = document.createElement('option');
            option.value = `${h.toString().padStart(2, '0')}:00`;
            option.textContent = `${h.toString().padStart(2, '0')}:00`;
            timeSelect.appendChild(option);
        }
        timeSelect.onchange = validateStep2;
    }
}

async function updateOwnerAccount() {
    const currentGmailEl = document.getElementById('current-gmail') || document.getElementById('modal-current-gmail');
    const newGmailEl = document.getElementById('new-gmail') || document.getElementById('modal-new-gmail');
    const currentPasswordEl = document.getElementById('current-password') || document.getElementById('modal-current-password');
    const newPasswordEl = document.getElementById('new-password') || document.getElementById('modal-new-password');
    const confirmPasswordEl = document.getElementById('confirm-password') || document.getElementById('modal-confirm-password');

    if (!currentGmailEl || !newGmailEl || !currentPasswordEl || !newPasswordEl || !confirmPasswordEl) {
        alert('Account settings form fields are missing from the page.');
        return;
    }

    const currentGmail = currentGmailEl.value.trim().toLowerCase();
    const newGmail = newGmailEl.value.trim().toLowerCase();
    const currentPassword = currentPasswordEl.value;
    const newPassword = newPasswordEl.value;
    const confirmPassword = confirmPasswordEl.value;

    if (!currentGmail || !newGmail || !currentPassword || !newPassword || !confirmPassword) {
        alert('Please fill in all fields');
        return;
    }

    if (!newGmail.endsWith('@gmail.com')) {
        alert('New Gmail must be a valid @gmail.com address');
        return;
    }

    if (newPassword.length < 6) {
        alert('New password must be at least 6 characters');
        return;
    }

    if (newPassword !== confirmPassword) {
        alert('New passwords do not match');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/update-owner-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                current_gmail: currentGmail,
                new_gmail: newGmail,
                current_password: currentPassword,
                new_password: newPassword
            })
        });
        const data = await response.json();

        if (data.success) {
            alert('Account updated successfully! Please login with your new credentials.');
            
            
            const currentGmailClear = document.getElementById('current-gmail') || document.getElementById('modal-current-gmail');
            const newGmailClear = document.getElementById('new-gmail') || document.getElementById('modal-new-gmail');
            const currentPasswordClear = document.getElementById('current-password') || document.getElementById('modal-current-password');
            const newPasswordClear = document.getElementById('new-password') || document.getElementById('modal-new-password');
            const confirmPasswordClear = document.getElementById('confirm-password') || document.getElementById('modal-confirm-password');
            
            if (currentGmailClear) currentGmailClear.value = '';
            if (newGmailClear) newGmailClear.value = '';
            if (currentPasswordClear) currentPasswordClear.value = '';
            if (newPasswordClear) newPasswordClear.value = '';
            if (confirmPasswordClear) confirmPasswordClear.value = '';
            
            
            logout();
        } else {
            alert(data.message || 'Failed to update account');
        }
    } catch (error) {
        console.error('Error updating account:', error);
        alert('Failed to update account. Please try again.');
    }
}

function loadOwnerAccountSettings() {
    if (currentUser && currentUser.role === 'owner') {
        const gmailInput = document.getElementById('current-gmail') || document.getElementById('modal-current-gmail');
        if (gmailInput) {
            gmailInput.value = currentUser.gmail;
        }
    }
}


function showProductManagementModal() {
    document.getElementById('product-management-modal').classList.add('active');
    loadModalManagementTable();
}

function closeProductManagementModal() {
    document.getElementById('product-management-modal').classList.remove('active');
}

async function loadModalManagementTable() {
    try {
        const response = await fetch(`${API_URL}/dashboard-data?period=${currentPeriod}`);
        const data = await response.json();
        
        if (data.success) {
            const productsResponse = await fetch(`${API_URL}/get-products-with-stock?owner=1`);
            const productsData = await productsResponse.json();
            
            if (productsData.success) {
                displayModalManagementTable(productsData.products, data.inventory);
            }
        }
    } catch (error) {
        console.error('Error loading modal management table:', error);
    }
}

function displayModalManagementTable(products, inventory) {
    const tbody = document.getElementById('modal-management-table-body');
    tbody.innerHTML = '';

    const searchTerm = document.getElementById('modal-management-search')?.value.toLowerCase() || '';
    const filtered = products.filter(p => p.name.toLowerCase().includes(searchTerm) || p.category.toLowerCase().includes(searchTerm));

    filtered.forEach(product => {
        const totalStock = product.variants ? product.variants.reduce((sum, v) => sum + (v.stock || 0), 0) : 0;
        const stockClass = totalStock < 10 ? 'low-stock' : 'in-stock';
        
        const pricesStr = Object.entries(product.prices).map(([qty, price]) => `${qty}:${CURRENCY}${price}`).join(', ');

        let variantsHtml = '';
        if (product.variants && product.variants.length > 0) {
            variantsHtml = '<div class="variants-list">';
            product.variants.forEach(variant => {
                const isAvailable = variant.available !== false;
                const statusClass = isAvailable ? 'variant-available' : 'variant-unavailable';
                const statusIcon = isAvailable ? '✓' : '✗';
                const btnText = isAvailable ? 'Disable' : 'Enable';
                const btnClass = isAvailable ? 'toggle-off-btn' : 'toggle-on-btn';
                
                variantsHtml += `
                    <div class="variant-item ${statusClass}">
                        <span class="variant-name">${variant.name}</span>
                        <span class="variant-stock" style="cursor:pointer;" onclick="openStockEditFromModal('${product.name.replace(/'/g, "\\'")}', ${variant.stock}, '${variant.name.replace(/'/g, "\\'")}')">Stock: ${variant.stock} <i class="fas fa-edit" style="font-size:10px;"></i></span>
                        <span class="variant-status">${statusIcon} ${isAvailable ? 'Available' : 'Unavailable'}</span>
                        <button class="${btnClass}" onclick="toggleAvailabilityFromModal('${product.name.replace(/'/g, "\\'")}', '${variant.name.replace(/'/g, "\\'")}')">
                            ${btnText}
                        </button>
                    </div>
                `;
            });
            variantsHtml += '</div>';
            
            if (product.unavailable_variants && product.unavailable_variants.length > 0) {
                variantsHtml += `<div class="unavailable-badge">${product.unavailable_variants.length} unavailable</div>`;
            }
        }
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${product.name}</td>
            <td>${product.category}</td>
            <td class="price-cell">${pricesStr}</td>
            <td class="stock-cell ${stockClass}">${totalStock}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn edit-price-btn" onclick="openPriceEdit('${product.name}')">
                        <i class="fas fa-edit"></i> Price
                    </button>
                    <button class="action-btn edit-stock-btn" onclick="openStockEditFromModal('${product.name}', ${totalStock})">
                        <i class="fas fa-box"></i> Stock
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
        
        if (variantsHtml) {
            const variantRow = document.createElement('tr');
            variantRow.className = 'variants-row';
            variantRow.innerHTML = `<td colspan="5">${variantsHtml}</td>`;
            tbody.appendChild(variantRow);
        }
    });
}

function openStockEditFromModal(productName, currentStock, variant) {
    
    openStockEdit(productName, currentStock, variant);
}

function openStockEditFromVariantModal(productName, currentStock, variant) {
    closeVariantManagementModal();
    openStockEdit(productName, currentStock, variant);
}

async function toggleAvailabilityFromModal(productName, variant) {
    await toggleAvailability(productName, variant);
    loadModalManagementTable();
}


function filterModalManagementProducts() {
    loadModalManagementTable();
}


function showAccountSettingsModal() {
    if (currentUser && currentUser.role === 'owner') {
        document.getElementById('modal-current-gmail').value = currentUser.gmail;
    }
    document.getElementById('account-settings-modal').classList.add('active');
}

function closeAccountSettingsModal() {
    document.getElementById('account-settings-modal').classList.remove('active');
    document.getElementById('modal-new-gmail').value = '';
    document.getElementById('modal-current-password').value = '';
    document.getElementById('modal-new-password').value = '';
    document.getElementById('modal-confirm-password').value = '';
}

async function updateOwnerAccountFromModal() {
    const currentGmail = document.getElementById('modal-current-gmail').value.trim().toLowerCase();
    const newGmail = document.getElementById('modal-new-gmail').value.trim().toLowerCase();
    const currentPassword = document.getElementById('modal-current-password').value;
    const newPassword = document.getElementById('modal-new-password').value;
    const confirmPassword = document.getElementById('modal-confirm-password').value;

    if (!currentGmail || !newGmail || !currentPassword || !newPassword || !confirmPassword) {
        alert('Please fill in all fields');
        return;
    }

    if (!newGmail.endsWith('@gmail.com')) {
        alert('New Gmail must be a valid @gmail.com address');
        return;
    }

    if (newPassword.length < 6) {
        alert('New password must be at least 6 characters');
        return;
    }

    if (newPassword !== confirmPassword) {
        alert('New passwords do not match');
        return;
    }

    try {
        // Check if email is changing
        if (currentGmail !== newGmail) {
            // Request OTP for email change
            const response = await fetch(`${API_URL}/request-owner-email-change`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_gmail: currentGmail,
                    new_gmail: newGmail,
                    password: currentPassword
                })
            });
            const data = await response.json();

            if (data.success) {
                // Store the update data in localStorage for OTP verification
                localStorage.setItem('ownerEmailChangeData', JSON.stringify({
                    currentGmail: currentGmail,
                    newGmail: newGmail,
                    newPassword: newPassword
                }));

                // Show OTP modal
                document.getElementById('owner-otp-email-display').textContent = newGmail;
                document.getElementById('owner-otp-code').value = '';
                document.getElementById('account-settings-modal').classList.remove('active');
                document.getElementById('owner-email-otp-modal').classList.add('active');
            } else {
                alert(data.message || 'Failed to request email change');
            }
        } else {
            // Only password is changing, no OTP needed
            const response = await fetch(`${API_URL}/update-owner-account`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_gmail: currentGmail,
                    new_gmail: newGmail,
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });
            const data = await response.json();

            if (data.success) {
                alert('Password updated successfully! Please login with your new password.');
                closeAccountSettingsModal();
                logout();
            } else {
                alert(data.message || 'Failed to update password');
            }
        }
    } catch (error) {
        console.error('Error updating account:', error);
        alert('Failed to update account. Please try again.');
    }
}

function closeOwnerEmailOtpModal() {
    document.getElementById('owner-email-otp-modal').classList.remove('active');
    localStorage.removeItem('ownerEmailChangeData');
}

function openAccountSettingsModal() {
    showAccountSettingsModal();
}

async function verifyOwnerEmailChange() {
    const otp = document.getElementById('owner-otp-code').value.trim();
    const changeData = JSON.parse(localStorage.getItem('ownerEmailChangeData') || '{}');

    if (!otp) {
        alert('Please enter the OTP code');
        return;
    }

    if (otp.length !== 6) {
        alert('OTP must be 6 digits');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/verify-owner-email-change`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                current_gmail: changeData.currentGmail,
                new_gmail: changeData.newGmail,
                otp: otp,
                new_password: changeData.newPassword
            })
        });
        const data = await response.json();

        if (data.success) {
            alert('Email and account updated successfully! Please login with your new credentials.');
            
            // Clear the form
            document.getElementById('owner-otp-code').value = '';
            document.getElementById('modal-current-gmail').value = '';
            document.getElementById('modal-new-gmail').value = '';
            document.getElementById('modal-current-password').value = '';
            document.getElementById('modal-new-password').value = '';
            document.getElementById('modal-confirm-password').value = '';
            
            // Close modal and logout
            document.getElementById('owner-email-otp-modal').classList.remove('active');
            localStorage.removeItem('ownerEmailChangeData');
            logout();
        } else {
            alert(data.message || 'OTP verification failed');
        }
    } catch (error) {
        console.error('OTP verification error:', error);
        alert('Verification failed. Please try again.');
    }
}



function showRecentOrdersModal() {
    document.getElementById('recent-orders-modal').classList.add('active');
    loadModalOrdersTable();
}

function closeRecentOrdersModal() {
    document.getElementById('recent-orders-modal').classList.remove('active');
}

async function loadModalOrdersTable() {
    try {
        const response = await fetch(`${API_URL}/dashboard-data?period=${currentPeriod}`);
        const data = await response.json();
        
        if (data.success) {
            displayModalOrdersTable(data.orders);
        }
    } catch (error) {
        console.error('Error loading modal orders table:', error);
    }
}

function displayModalOrdersTable(orders) {
    const tbody = document.getElementById('modal-orders-table-body');
    tbody.innerHTML = '';

    orders.forEach(order => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${order._id.slice(-8)}</td>
            <td>${order.customer_gmail}</td>
            <td>${order.items.length} items</td>
            <td>${CURRENCY}${order.total}</td>
            <td><span class="status-badge status-${order.status}">${order.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn deliver-btn" onclick="updateOrderStatusFromModal('${order.order_id}', 'delivered')" ${order.status === 'delivered' ? 'disabled' : ''}>
                        <i class="fas fa-check"></i> Delivered
                    </button>
                    <button class="action-btn cancel-btn" onclick="updateOrderStatusFromModal('${order.order_id}', 'cancelled')" ${order.status === 'cancelled' ? 'disabled' : ''}>
                        <i class="fas fa-times"></i> Cancelled
                    </button>
                </div>
            </td>
            <td>${new Date(order.created_at).toLocaleDateString()}</td>
        `;
        tbody.appendChild(row);
    });
}

async function updateOrderStatusFromModal(orderId, status) {
    try {
        const response = await fetch(`${API_URL}/update-order-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, status: status })
        });
        const data = await response.json();
        
        if (data.success) {
            if (status === 'delivered') {
                alert('Order marked as delivered!');
            } else {
                alert('Order cancelled!');
            }
            loadModalOrdersTable();
            loadDashboardData(currentPeriod);
        } else {
            alert('Failed to update order status');
        }
    } catch (error) {
        console.error('Error updating order status:', error);
        alert('Error updating order status');
    }
}

let pmProducts = [];
let currentEditingProduct = null;
let currentVariantProduct = null;

function showProductManagementModal() {
    document.getElementById('product-management-modal').classList.add('active');
    loadProductManagementData();
    loadCategoriesForManagement();
}

function closeProductManagementModal() {
    document.getElementById('product-management-modal').classList.remove('active');
}

function switchProductManagementTab(tab) {
    document.getElementById('pm-tab-manage').classList.remove('active');
    document.getElementById('pm-tab-add').classList.remove('active');
    document.getElementById('pm-tab-categories').classList.remove('active');
    document.getElementById('pm-manage-tab').classList.remove('active');
    document.getElementById('pm-add-tab').classList.remove('active');
    document.getElementById('pm-categories-tab').classList.remove('active');
    
    document.getElementById(`pm-tab-${tab}`).classList.add('active');
    document.getElementById(`pm-${tab}-tab`).classList.add('active');
    
    
    if (tab === 'categories' || tab === 'add') {
        loadCategoriesForManagement();
    }
}

async function loadProductManagementData() {
    try {
        const response = await fetch(`${API_URL}/get-products-with-stock?owner=1`);
        const data = await response.json();
        
        if (data.success) {
            pmProducts = data.products;
            renderProductManagementList();
        }
    } catch (error) {
        console.error('Error loading products for management:', error);
    }
}

function renderProductManagementList() {
    const container = document.getElementById('pm-products-list');
    container.innerHTML = '';
    
    const searchTerm = document.getElementById('pm-search')?.value.toLowerCase() || '';
    const categoryFilter = document.getElementById('pm-category-filter')?.value || '';
    
    let filtered = pmProducts;
    
    if (categoryFilter) {
        filtered = filtered.filter(p => p.category === categoryFilter);
    }
    
    if (searchTerm) {
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(searchTerm) || 
            p.category.toLowerCase().includes(searchTerm)
        );
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-notifications"><p>No products found</p></div>';
        return;
    }
    
    filtered.forEach(product => {
        const hasVariants = product.variants && product.variants.length > 0;
        const variantType = product.colors ? 'color' : (product.flavors ? 'flavor' : null);
        
        const card = document.createElement('div');
        card.className = 'pm-product-card';
        card.innerHTML = `
            <div class="pm-product-header">
                <div class="pm-product-info">
                    <h4>${product.name}</h4>
                    <span class="pm-category">${product.category}</span>
                </div>
                <div class="pm-product-actions">
                    ${hasVariants ? `<button class="action-btn pm-manage-variants-btn" onclick="openVariantManagement('${product.name.replace(/'/g, "\\'")}', '${variantType}')">
                        <i class="fas fa-palette"></i> Variants
                    </button>` : ''}
                    <button class="action-btn pm-edit-price-btn" onclick="openPriceEdit('${product.name.replace(/'/g, "\\'")}')">
                        <i class="fas fa-edit"></i> Price
                    </button>
                    <button class="action-btn pm-delete-btn" onclick="deleteProduct('${product.name.replace(/'/g, "\\'")}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
            <div class="pm-product-prices">
                ${Object.entries(product.prices).map(([qty, price]) => `<span>${qty}pcs: ${CURRENCY}${price}</span>`).join('')}
            </div>
            ${hasVariants ? `
                <div class="pm-variants-preview">
                    <h5>${variantType === 'color' ? 'Colors' : 'Flavors'} (${product.variants.length})</h5>
                    <div class="pm-variants-tags">
                        ${product.variants.slice(0, 10).map(v => `
                            <span class="pm-variant-tag ${v.available === false ? 'unavailable' : ''}">${v.name}</span>
                        `).join('')}
                        ${product.variants.length > 10 ? `<span class="pm-variant-tag">+${product.variants.length - 10} more</span>` : ''}
                    </div>
                </div>
            ` : ''}
        `;
        container.appendChild(card);
    });
}

function filterProductManagementProducts() {
    renderProductManagementList();
}

function toggleVariantInput() {
    const type = document.getElementById('new-product-type').value;
    const colorsGroup = document.getElementById('new-product-colors-group');
    const flavorsGroup = document.getElementById('new-product-flavors-group');
    
    if (type === 'color') {
        colorsGroup.style.display = 'block';
        flavorsGroup.style.display = 'none';
    } else if (type === 'flavor') {
        colorsGroup.style.display = 'none';
        flavorsGroup.style.display = 'block';
    } else {
        colorsGroup.style.display = 'none';
        flavorsGroup.style.display = 'none';
    }
}

async function addNewProduct() {
    const name = document.getElementById('new-product-name').value.trim();
    const category = document.getElementById('new-product-category').value;
    const pricesText = document.getElementById('new-product-prices').value.trim();
    const type = document.getElementById('new-product-type').value;
    const colorsText = document.getElementById('new-product-colors').value.trim();
    const flavorsText = document.getElementById('new-product-flavors').value.trim();
    
    
    const imageUploadType = document.querySelector('input[name="image-upload-type"]:checked')?.value || 'url';
    let imageFilename = 'default.jpg';
    
    if (imageUploadType === 'file') {
        
        const fileInput = document.getElementById('new-product-image-file');
        const file = fileInput?.files[0];
        
        if (file) {
            try {
                const formData = new FormData();
                formData.append('image', file);
                
                const uploadResponse = await fetch(`${API_URL}/upload-product-image`, {
                    method: 'POST',
                    body: formData
                });
                const uploadData = await uploadResponse.json();
                
                if (uploadData.success) {
                    imageFilename = uploadData.filename;
                } else {
                    alert('Image upload failed: ' + uploadData.message);
                    return;
                }
            } catch (error) {
                console.error('Error uploading image:', error);
                imageFilename = 'default.jpg';
            }
        }
    } else {
        
        imageFilename = document.getElementById('new-product-image')?.value.trim() || 'default.jpg';
    }
    
    if (!name) {
        alert('Please enter a product name');
        return;
    }
    
    if (!category) {
        alert('Please select a category');
        return;
    }
    
    if (!pricesText) {
        alert('Please enter at least one price');
        return;
    }
    
    
    const prices = {};
    const pricesLines = pricesText.split('\n');
    pricesLines.forEach(line => {
        const [qty, price] = line.split(':').map(s => s.trim());
        if (qty && price) {
            prices[qty] = parseInt(price);
        }
    });
    
    if (Object.keys(prices).length === 0) {
        alert('Please enter valid prices (format: quantity:price)');
        return;
    }
    
    
    let colors = [];
    let flavors = [];
    
    if (type === 'color' && colorsText) {
        colors = colorsText.split('\n').map(c => c.trim()).filter(c => c);
    } else if (type === 'flavor' && flavorsText) {
        flavors = flavorsText.split('\n').map(f => f.trim()).filter(f => f);
    }
    
    try {
        const response = await fetch(`${API_URL}/add-new-product`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                category: category,
                prices: prices,
                colors: colors,
                flavors: flavors,
                image: imageFilename
            })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Product added successfully!');
            
            document.getElementById('new-product-name').value = '';
            document.getElementById('new-product-category').value = '';
            document.getElementById('new-product-prices').value = '';
            document.getElementById('new-product-colors').value = '';
            document.getElementById('new-product-flavors').value = '';
            document.getElementById('new-product-image').value = '';
            document.getElementById('new-product-type').value = 'color';
            toggleVariantInput();
            
            
            loadProductManagementData();
            loadDashboardData(currentPeriod);
            fetchProducts();
        } else {
            alert(data.message || 'Failed to add product');
        }
    } catch (error) {
        console.error('Error adding product:', error);
        alert('Failed to add product');
    }
}

async function deleteProduct(productName) {
    if (!confirm(`Are you sure you want to delete "${productName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/delete-product`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_name: productName })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Product deleted successfully!');
            loadProductManagementData();
            loadDashboardData(currentPeriod);
            fetchProducts();
        } else {
            alert(data.message || 'Failed to delete product');
        }
    } catch (error) {
        console.error('Error deleting product:', error);
        alert('Failed to delete product');
    }
}



function openVariantManagement(productName, variantType) {
    currentVariantProduct = productName;
    document.getElementById('variant-modal-product-name').textContent = productName;
    
    const typeLabel = variantType === 'color' ? 'Color' : 'Flavor';
    document.getElementById('add-variant-label').textContent = `Add New ${typeLabel}`;
    document.getElementById('variant-type-info').innerHTML = `<p>Managing ${typeLabel}s for ${productName}</p>`;
    
    
    document.getElementById('variant-management-modal').dataset.variantType = variantType;
    
    loadVariantsForProduct(productName, variantType);
    document.getElementById('variant-management-modal').classList.add('active');
}

function closeVariantManagementModal() {
    document.getElementById('variant-management-modal').classList.remove('active');
    currentVariantProduct = null;
}

async function loadVariantsForProduct(productName, variantType) {
    try {
        const response = await fetch(`${API_URL}/get-products-with-stock?owner=1`);
        const data = await response.json();
        
        if (data.success) {
            const product = data.products.find(p => p.name === productName);
            if (product) {
                renderVariantsList(product.variants || [], variantType);
            }
        }
    } catch (error) {
        console.error('Error loading variants:', error);
    }
}

function renderVariantsList(variants, variantType) {
    const container = document.getElementById('current-variants-list');
    container.innerHTML = '';
    
    if (variants.length === 0) {
        container.innerHTML = '<div class="empty-notifications"><p>No variants available</p></div>';
        return;
    }
    
    variants.forEach(variant => {
        const item = document.createElement('div');
        item.className = `current-variant-item ${variant.available === false ? 'unavailable' : ''}`;
        item.innerHTML = `
            <div class="variant-info">
                <span class="variant-name">${variant.name}</span>
                <span class="variant-stock-badge">Stock: ${variant.stock}</span>
                <span class="variant-status-badge ${variant.available !== false ? 'available' : 'unavailable'}">
                    ${variant.available !== false ? 'Available' : 'Unavailable'}
                </span>
            </div>
            <div class="variant-actions">
                <button class="variant-edit-stock-btn" onclick="openStockEditFromVariantModal(currentVariantProduct, ${variant.stock}, '${variant.name.replace(/'/g, "\\'")}')">
                    <i class="fas fa-edit"></i> Stock
                </button>
                <button class="variant-toggle-btn ${variant.available === false ? '' : 'disabled'}" 
                    onclick="toggleVariantAvailability(currentVariantProduct, '${variant.name.replace(/'/g, "\\'")}')">
                    ${variant.available !== false ? 'Disable' : 'Enable'}
                </button>
                <button class="variant-remove-btn" onclick="removeVariant('${variant.name.replace(/'/g, "\\'")}')">
                    Remove
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

async function addVariant() {
    const variantName = document.getElementById('new-variant-name').value.trim();
    
    if (!variantName) {
        alert('Please enter a variant name');
        return;
    }
    
    if (!currentVariantProduct) {
        alert('No product selected');
        return;
    }
    
    const variantType = document.getElementById('variant-management-modal').dataset.variantType || 'color';
    
    try {
        const response = await fetch(`${API_URL}/add-product-variant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_name: currentVariantProduct,
                variant: variantName,
                variant_type: variantType
            })
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`${variantType === 'color' ? 'Color' : 'Flavor'} added successfully!`);
            document.getElementById('new-variant-name').value = '';
            loadVariantsForProduct(currentVariantProduct, variantType);
            loadProductManagementData();
            loadDashboardData(currentPeriod);
            fetchProducts();
        } else {
            alert(data.message || 'Failed to add variant');
        }
    } catch (error) {
        console.error('Error adding variant:', error);
        alert('Failed to add variant');
    }
}

async function removeVariant(variantName) {
    if (!confirm(`Are you sure you want to remove "${variantName}"? This will also remove it from inventory.`)) {
        return;
    }
    
    const variantType = document.getElementById('variant-management-modal').dataset.variantType || 'color';
    
    try {
        const response = await fetch(`${API_URL}/remove-product-variant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_name: currentVariantProduct,
                variant: variantName,
                variant_type: variantType
            })
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`${variantType === 'color' ? 'Color' : 'Flavor'} removed successfully!`);
            loadVariantsForProduct(currentVariantProduct, variantType);
            loadProductManagementData();
            loadDashboardData(currentPeriod);
            fetchProducts();
        } else {
            alert(data.message || 'Failed to remove variant');
        }
    } catch (error) {
        console.error('Error removing variant:', error);
        alert('Failed to remove variant');
    }
}

async function toggleVariantAvailability(productName, variantName) {
    try {
        const response = await fetch(`${API_URL}/toggle-variant-availability`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_name: productName,
                variant: variantName
            })
        });
        const data = await response.json();
        
        if (data.success) {
            
            const variantModal = document.getElementById('variant-management-modal');
            if (variantModal && variantModal.classList.contains('active')) {
                const variantType = variantModal.dataset.variantType || 'color';
                loadVariantsForProduct(productName, variantType);
            }
           
            loadProductManagementData();
            loadDashboardData(currentPeriod);
        } else {
            alert(data.message || 'Failed to toggle availability');
        }
    } catch (error) {
        console.error('Error toggling variant availability:', error);
        alert('Failed to toggle availability');
    }
}



let allCategories = [];

async function fetchCategories() {
    try {
        const response = await fetch(`${API_URL}/get-categories`);
        const data = await response.json();
        if (data.success) {
            allCategories = data.categories || [];
            return allCategories;
        }
    } catch (error) {
        console.error('Error fetching categories:', error);
    }
    return [];
}

function populateCategoryDropdowns() {
    const categoryFilter = document.getElementById('category-filter');
    const productCategorySelect = document.getElementById('new-product-category');
    const pmCategoryFilter = document.getElementById('pm-category-filter');
    
    const categories = allCategories.map(c => c.name);
    
    
    if (categoryFilter) {
        const currentValue = categoryFilter.value;
        categoryFilter.innerHTML = '<option value="">All Categories</option>';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            categoryFilter.appendChild(option);
        });
        categoryFilter.value = currentValue;
    }
    
   
    if (productCategorySelect) {
        const currentValue = productCategorySelect.value;
        productCategorySelect.innerHTML = '<option value="">Select Category</option>';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            productCategorySelect.appendChild(option);
        });
        productCategorySelect.value = currentValue;
    }
    
   
    if (pmCategoryFilter) {
        const currentValue = pmCategoryFilter.value;
        pmCategoryFilter.innerHTML = '<option value="">All Categories</option>';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            pmCategoryFilter.appendChild(option);
        });
        pmCategoryFilter.value = currentValue;
    }
}

async function loadCategoriesForManagement() {
    await fetchCategories();
    populateCategoryDropdowns();
    renderCategoriesList();
}

function renderCategoriesList() {
    const container = document.getElementById('categories-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (allCategories.length === 0) {
        container.innerHTML = '<div class="empty-notifications"><p>No categories found</p></div>';
        return;
    }
    
    allCategories.forEach(category => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.innerHTML = `
            <div class="category-info">
                <span class="category-name">${category.name}</span>
            </div>
            <div class="category-actions">
                <button class="category-delete-btn" onclick="deleteCategory('${category.name}')">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

async function addNewCategory() {
    const categoryName = document.getElementById('new-category-name').value.trim();
    
    if (!categoryName) {
        alert('Please enter a category name');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/add-category`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: categoryName })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Category added successfully!');
            document.getElementById('new-category-name').value = '';
            loadCategoriesForManagement();
        } else {
            alert(data.message || 'Failed to add category');
        }
    } catch (error) {
        console.error('Error adding category:', error);
        alert('Failed to add category');
    }
}


async function deleteCategory(categoryName) {
    if (!confirm(`Are you sure you want to delete "${categoryName}"? This cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/delete-category`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: categoryName })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Category deleted successfully!');
            loadCategoriesForManagement();
        } else {
            alert(data.message || 'Failed to delete category');
        }
    } catch (error) {
        console.error('Error deleting category:', error);
        alert('Failed to delete category');
    }
}


function toggleImageUploadType() {
    const uploadType = document.querySelector('input[name="image-upload-type"]:checked')?.value || 'url';
    const fileGroup = document.getElementById('image-file-input-group');
    const urlGroup = document.getElementById('image-url-input-group');
    
    if (uploadType === 'file') {
        if (fileGroup) fileGroup.style.display = 'block';
        if (urlGroup) urlGroup.style.display = 'none';
    } else {
        if (fileGroup) fileGroup.style.display = 'none';
        if (urlGroup) urlGroup.style.display = 'block';
    }
}


function previewUploadedImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('uploaded-image-preview');
            const container = document.getElementById('image-preview-container');
            if (preview) preview.src = e.target.result;
            if (container) container.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}


function removeUploadedImage() {
    const fileInput = document.getElementById('new-product-image-file');
    const preview = document.getElementById('uploaded-image-preview');
    const container = document.getElementById('image-preview-container');
    if (fileInput) fileInput.value = '';
    if (preview) preview.src = '';
    if (container) container.style.display = 'none';
}




let bundleItems = [];
let bundleIdCounter = 1;

function openBundleModal() {
    if (!currentUser) {
        alert('Please login to create a bundle');
        showLoginModal();
        return;
    }
    bundleItems = [];
    document.getElementById('bundle-modal').classList.add('active');
    renderBundleItems();
}

function closeBundleModal() {
    document.getElementById('bundle-modal').classList.remove('active');
    bundleItems = [];
}

function addBundleItem() {
if (bundleItems.length >= 10) {
        alert('Maximum 10 items allowed in a bundle');
        return;
    }
    
    const newItem = {
        id: Date.now(),
        product: null,
        quantity: '',
        color: '',
        flavor: '',
        price: 0
    };
    
    bundleItems.push(newItem);
    renderBundleItems();
}

function removeBundleItem(index) {
    bundleItems.splice(index, 1);
    renderBundleItems();
    updateBundleTotal();
}

function renderBundleItems() {
    const container = document.getElementById('bundle-items-container');
    container.innerHTML = '';
    
    if (bundleItems.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#666;">Click "Add Product to Bundle" to start</p>';
    }
    
    bundleItems.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'bundle-item';
        itemDiv.innerHTML = `
            <div class="bundle-item-header">
                <span class="bundle-item-number">${index + 1}</span>
                <button class="bundle-item-remove" onclick="removeBundleItem(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="bundle-item-product">
                <select onchange="selectBundleProduct(${index}, this.value)">
                    <option value="">Select Product</option>
                    ${products.map(p => `<option value="${p.name}" ${item.product === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
                </select>
            </div>
            <div class="bundle-item-options">
                <select id="bundle-qty-${index}" onchange="updateBundleItemPrice(${index})">
                    <option value="">Qty</option>
                </select>
                <select id="bundle-color-${index}" onchange="updateBundleItemOption(${index}, 'color', this.value)" ${!item.product || !hasColors(item.product) ? 'style="display:none"' : ''}>
                    <option value="">Color</option>
                </select>
                <select id="bundle-flavor-${index}" onchange="updateBundleItemOption(${index}, 'flavor', this.value)" ${!item.product || !hasFlavors(item.product) ? 'style="display:none"' : ''}>
                    <option value="">Flavor</option>
                </select>
            </div>
            <div class="bundle-item-price" id="bundle-price-${index}">
                ${item.price > 0 ? '₱' + item.price : ''}
            </div>
        `;
        container.appendChild(itemDiv);
        
        
        if (item.product) {
            const product = products.find(p => p.name === item.product);
            if (product) {
                
                const qtySelect = document.getElementById(`bundle-qty-${index}`);
                Object.keys(product.prices).forEach(qty => {
                    const option = document.createElement('option');
                    option.value = qty;
                    option.textContent = qty + ' pcs';
                    if (item.quantity === qty) option.selected = true;
                    qtySelect.appendChild(option);
                });
                
                
                if (product.colors && product.colors.length > 0) {
                    const colorSelect = document.getElementById(`bundle-color-${index}`);
                    product.colors.forEach(color => {
                        const option = document.createElement('option');
                        option.value = color;
                        option.textContent = color;
                        if (item.color === color) option.selected = true;
                        colorSelect.appendChild(option);
                    });
                }
                
                
                if (product.flavors && product.flavors.length > 0) {
                    const flavorSelect = document.getElementById(`bundle-flavor-${index}`);
                    product.flavors.forEach(flavor => {
                        const option = document.createElement('option');
                        option.value = flavor;
                        option.textContent = flavor;
                        if (item.flavor === flavor) option.selected = true;
                        flavorSelect.appendChild(option);
                    });
                }
            }
        }
    });
    
    
    const addBtn = document.querySelector('.add-bundle-item-btn');
    if (addBtn) {
addBtn.disabled = bundleItems.length >= 10;
    }
    
    updateBundleTotal();
}

// ==================== NOTIFICATION FUNCTIONS ====================

async function fetchNotifications() {
    if (!currentUser) {
        console.log('[Notifications] No current user');
        return;
    }

    // Toggle which bell button to show (customer vs owner)
    const customerBtn = document.getElementById('notifications-btn-customer');
    const ownerBtn = document.getElementById('notifications-btn-owner');
    if (customerBtn && ownerBtn) {
        customerBtn.style.display = currentUser.role === 'customer' ? 'flex' : 'none';
        ownerBtn.style.display = currentUser.role === 'owner' ? 'flex' : 'none';
    }

    
    try {
        console.log('[Notifications] Fetching for user:', currentUser.gmail, 'role:', currentUser.role);
        const response = await fetch(`${API_URL}/get-notifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gmail: currentUser.gmail,
                role: currentUser.role
            })
        });
        
        const data = await response.json();
        console.log('[Notifications] Response:', data);
        
        if (data.success && data.notifications && data.notifications.length > 0) {
            console.log('[Notifications] Received', data.notifications.length, 'notifications');
            const userRole = currentUser.role;
            currentNotifications = data.notifications;
            
            // Get role-specific tracking
            const roleTracking = notificationTracking[userRole];
            
            // Check if there are NEW notifications (count increased for this specific role)
            if (data.notifications.length > roleTracking.lastFetchedCount) {
                console.log(`[Notifications] NEW ${userRole} notifications detected! Previous:`, roleTracking.lastFetchedCount, 'Current:', data.notifications.length);
                // Show modal popup only for new notifications
                showNewNotificationModal(data.notifications);
            }
            
            // Update role-specific tracking
            roleTracking.lastFetchedCount = data.notifications.length;
            roleTracking.notifications = data.notifications;
        } else {
            console.log('[Notifications] No notifications to display');
            currentNotifications = [];
            const userRole = currentUser.role;
            notificationTracking[userRole].lastFetchedCount = 0;
            notificationTracking[userRole].notifications = [];
        }
    } catch (error) {
        console.error('[Notifications] Error fetching:', error);
    }
}

function displayNotifications(notifications) {
    const list = document.getElementById('header-notification-list');
    const count = document.getElementById('notification-count');
    
    if (!list || !count) return;
    
    count.textContent = notifications.length;
    list.innerHTML = '';
    
    notifications.forEach(notification => {
        const item = createNotificationItem(notification);
        list.appendChild(item);
    });

    // Update badge counters
    const customerBadge = document.getElementById('notification-badge-customer');
    const ownerBadge = document.getElementById('notification-badge-owner');
    if (customerBadge && ownerBadge) {
        if (currentUser?.role === 'customer') {
            customerBadge.textContent = notifications.length;
            customerBadge.style.display = (notifications.length > 0 && !notificationsSeen) ? 'inline-flex' : 'none';
            ownerBadge.style.display = 'none';
        } else if (currentUser?.role === 'owner') {
            ownerBadge.textContent = notifications.length;
            ownerBadge.style.display = (notifications.length > 0 && !notificationsSeen) ? 'inline-flex' : 'none';
            customerBadge.style.display = 'none';
        }
    }
}

function showNewNotificationModal(notifications) {
    // Only show modal for new notifications
    const header = document.getElementById('notification-header');
    const overlay = document.getElementById('notification-modal-overlay');
    
    if (!header || !overlay) return;
    
    // Display the notification list
    displayNotifications(notifications);
    
    // Show the modal
    header.style.display = 'flex';
    overlay.style.display = 'block';
    
    // Mark as not seen since new notification arrived
    notificationsSeen = false;
}

function createNotificationItem(notification) {
    const item = document.createElement('div');
    item.className = `notification-item ${notification.type}`;
    
    let badge = '';
    let meta = '';
    
    if (notification.type === 'order_ready') {
        badge = `<span class="notification-item-badge">Ready</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
    } else if (notification.type === 'order_received') {
        badge = `<span class="notification-item-badge">Received</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
        if (notification.customer) {
            meta += `<span class="notification-item-customer"><i class="fas fa-user"></i> ${notification.customer}</span>`;
        }
    } else if (notification.type === 'order_status') {
        badge = `<span class="notification-item-badge">${notification.status}</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
        if (notification.total) {
            meta += `<span class="notification-item-amount"><i class="fas fa-tag"></i> ₱${notification.total}</span>`;
        }
    } else if (notification.type === 'pending_order') {
        badge = `<span class="notification-item-badge">${notification.status}</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
        meta += `<span class="notification-item-items"><i class="fas fa-shopping-bag"></i> ${notification.items_count} items</span>`;
    } else if (notification.type === 'return_request') {
        badge = `<span class="notification-item-badge">Return Request</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
        if (notification.customer) {
            meta += `<span class="notification-item-customer"><i class="fas fa-user"></i> ${notification.customer}</span>`;
        }
    } else if (notification.type === 'return_approved') {
        badge = `<span class="notification-item-badge" style="background: #d4edda; color: #155724;">Approved</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
    } else if (notification.type === 'return_disapproved') {
        badge = `<span class="notification-item-badge" style="background: #f8d7da; color: #721c24;">Disapproved</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
    } else if (notification.type === 'message') {
        badge = `<span class="notification-item-badge">New Message</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
        if (notification.sender) {
            meta += `<span class="notification-item-sender"><i class="fas fa-user"></i> ${notification.sender}</span>`;
        }
    } else if (notification.type === 'low_stock') {
        badge = `<span class="notification-item-badge">Low Stock</span>`;
        meta = `<span class="notification-item-stock"><i class="fas fa-box"></i> ${notification.stock} left</span>`;
    } else if (notification.type === 'customer_login') {
        badge = `<span class="notification-item-badge">Login</span>`;
        meta = `<span class="notification-item-date"><i class="fas fa-calendar"></i> ${notification.date}</span>`;
        if (notification.time) {
            meta += `<span class="notification-item-time"><i class="fas fa-clock"></i> ${notification.time}</span>`;
        }
    }
    
    item.innerHTML = `
        <div class="notification-item-icon">
            <i class="fas ${notification.icon}"></i>
        </div>
        <div class="notification-item-content">
            <div class="notification-item-message">
                ${notification.message}
                ${badge}
            </div>
            <div class="notification-item-meta">
                ${meta}
            </div>
        </div>
    `;
    
    return item;
}

function closeNotificationHeader() {
    const header = document.getElementById('notification-header');
    const overlay = document.getElementById('notification-modal-overlay');
    if (header) {
        header.style.display = 'none';
    }
    if (overlay) {
        overlay.style.display = 'none';
    }
    // Mark notifications as seen when closing the modal
    markNotificationsAsSeen();
}

function markNotificationsAsSeen() {
    // Mark notifications as seen
    notificationsSeen = true;
    
    // Clear the badge after notifications are viewed
    const customerBadge = document.getElementById('notification-badge-customer');
    const ownerBadge = document.getElementById('notification-badge-owner');
    
    if (customerBadge) {
        customerBadge.style.display = 'none';
    }
    if (ownerBadge) {
        ownerBadge.style.display = 'none';
    }

    // Call backend to mark notifications as seen
    if (currentUser) {
        fetch(`${API_URL}/mark-notifications-seen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gmail: currentUser.gmail,
                role: currentUser.role
            })
        }).catch(error => console.error('Error marking notifications as seen:', error));
    }
}

function openNotificationHeader() {
    // Just display the current notifications list without showing modal
    displayNotifications(currentNotifications);
    
    const header = document.getElementById('notification-header');
    if (header) {
        header.style.display = 'flex';
    }
    // Don't show overlay or modal when user manually clicks - only for new notifications
}





// Refresh notifications periodically
function startNotificationRefresh() {
    if (!currentUser) return;
    
    // Initial fetch
    fetchNotifications();
    
    // Refresh every 30 seconds
    notificationRefreshInterval = setInterval(() => {
        if (currentUser) {
            fetchNotifications();
        }
    }, 30000);
}

function stopNotificationRefresh() {
    if (notificationRefreshInterval) {
        clearInterval(notificationRefreshInterval);
        notificationRefreshInterval = null;
    }
}

function clearNotificationBadges() {
    // Clear notification header list
    const headerList = document.getElementById('header-notification-list');
    if (headerList) {
        headerList.innerHTML = '';
    }
    
    // Clear all notification badge dots
    const customerBadge = document.getElementById('notification-badge-customer');
    const ownerBadge = document.getElementById('notification-badge-owner');
    const notificationBadge = document.getElementById('notification-badge');
    
    if (customerBadge) customerBadge.style.display = 'none';
    if (ownerBadge) ownerBadge.style.display = 'none';
    if (notificationBadge) notificationBadge.style.display = 'none';
}

let notificationRefreshInterval = null;

function hasColors(productName) {
    const product = products.find(p => p.name === productName);
    return product && product.colors && product.colors.length > 0;
}

function hasFlavors(productName) {
    const product = products.find(p => p.name === productName);
    return product && product.flavors && product.flavors.length > 0;
}

function selectBundleProduct(index, productName) {
    bundleItems[index].product = productName;
    bundleItems[index].quantity = '';
    bundleItems[index].color = '';
    bundleItems[index].flavor = '';
    bundleItems[index].price = 0;
    
    renderBundleItems();
}

function updateBundleItemOption(index, type, value) {
    bundleItems[index][type] = value;
    updateBundleTotal();
}

function updateBundleItemPrice(index) {
    const item = bundleItems[index];
    const qtySelect = document.getElementById(`bundle-qty-${index}`);
    item.quantity = qtySelect.value;
    
    const product = products.find(p => p.name === item.product);
    if (product && item.quantity) {
        item.price = product.prices[item.quantity] || 0;
        document.getElementById(`bundle-price-${index}`).textContent = '₱' + item.price;
    }
    
    updateBundleTotal();
}

function updateBundleTotal() {
    const total = bundleItems.reduce((sum, item) => sum + item.price, 0);
    document.getElementById('bundle-total-price').textContent = '₱' + total;
    
    
    const addBtn = document.getElementById('add-bundle-to-cart-btn');
const validBundle = bundleItems.length >= 2 && bundleItems.every(item => 
        item.product && item.quantity && item.price > 0
    );
    addBtn.disabled = !validBundle;
}

function addBundleToCart() {
if (bundleItems.length < 2) {
        alert('Please add at least 2 products to create a bundle');
        return;
    }
    
    const validBundle = bundleItems.every(item => 
        item.product && item.quantity && item.price > 0
    );
    if (!validBundle) {
        alert('Please complete all product selections');
        return;
    }
    
    const bundle_id = 'BUNDLE-' + bundleIdCounter++;
    const bundleTotal = bundleItems.reduce((sum, item) => sum + item.price, 0);
    
    const bundleItem = {
        is_bundle: true,
        bundle_id: bundle_id,
        items: bundleItems.map(item => ({
            name: item.product,
            quantity: item.quantity,
            color: item.color,
            flavor: item.flavor,
            price: item.price,
            details: item.quantity + ' pcs' + (item.color ? ' - ' + item.color : '') + (item.flavor ? ' - ' + item.flavor : '')
        })),
        total_price: bundleTotal,
details: `${bundleItems.length} items bundle (min 2, max 10)`
    };
    
    cart.push(bundleItem);
    updateCartBadge();
    saveCart();
    closeBundleModal();
    alert('Bundle added to cart!');
}

// ===== MESSAGING FUNCTIONS =====

let currentChatUser = null;

async function openMessagesModal() {
    if (!currentUser) {
        alert('Please login first');
        return;
    }
    
    document.getElementById('messages-modal').style.display = 'flex';
    await loadConversations();
}

function closeMessagesModal() {
    document.getElementById('messages-modal').style.display = 'none';
    currentChatUser = null;
}

async function loadConversations() {
    try {
        const response = await fetch(`${API_URL}/get-conversations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail: currentUser.gmail })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const conversationsContainer = document.getElementById('conversations-items');
            conversationsContainer.innerHTML = '';
            
            if (data.conversations.length === 0) {
                conversationsContainer.innerHTML = '<p class="no-conversations">No conversations yet. Start a new message!</p>';
                return;
            }
            
            data.conversations.forEach(conv => {
                const item = document.createElement('div');
                item.className = 'conversation-item';
                item.onclick = () => openChat(conv.other_user);
                
                const timestamp = new Date(conv.latest_timestamp).toLocaleString();
                item.innerHTML = `
                    <div class="conversation-header">
                        <strong>${conv.other_user}</strong>
                        <span class="conversation-time">${timestamp}</span>
                    </div>
                    <div class="conversation-preview">${conv.latest_message}</div>
                `;
                
                conversationsContainer.appendChild(item);
            });
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
        alert('Error loading conversations');
    }
}

async function openChat(otherUser) {
    currentChatUser = otherUser;
    
    // Show chat area and hide conversations list
    document.getElementById('conversations-list').style.display = 'none';
    document.getElementById('messages-chat').style.display = 'flex';
    document.getElementById('chat-with-user').textContent = `Chat with ${otherUser}`;
    document.getElementById('message-input').value = '';
    document.getElementById('message-input').focus();
    
    await loadMessages();
}

function backToConversations() {
    currentChatUser = null;
    document.getElementById('conversations-list').style.display = 'block';
    document.getElementById('messages-chat').style.display = 'none';
    const emailInput = document.getElementById('new-conversation-email');
    if (emailInput) emailInput.value = '';
}

async function startNewConversation() {
    const emailInput = document.getElementById('new-conversation-email');
    const email = emailInput.value.trim().toLowerCase();
    
    if (!email) {
        alert('Please enter a Gmail address');
        return;
    }
    
    if (!email.endsWith('@gmail.com')) {
        alert('Please use a valid Gmail address (@gmail.com)');
        return;
    }
    
    if (email === currentUser.gmail) {
        alert('You cannot message yourself');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/check-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail: email })
        });
        const data = await response.json();
        
        if (data.success && !data.exists) {
            const proceed = confirm(`Warning: ${email} is not registered in our system. They won't see your messages until they sign up. Start conversation anyway?`);
            if (!proceed) return;
        }
        
        emailInput.value = '';
        await openChat(email);
    } catch (error) {
        console.error('Error checking user:', error);
        alert('Error starting conversation. Please try again.');
    }
}

async function loadMessages() {
    if (!currentChatUser) return;
    
    try {
        const response = await fetch(`${API_URL}/get-messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user1: currentUser.gmail,
                user2: currentChatUser
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const messagesBody = document.getElementById('messages-body');
            messagesBody.innerHTML = '';
            
            data.messages.forEach(msg => {
                const msgDiv = document.createElement('div');
                const isSent = msg.sender === currentUser.gmail;
                msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
                
                const timestamp = new Date(msg.timestamp).toLocaleTimeString();
                msgDiv.innerHTML = `
                    <div class="message-content">
                        <p>${msg.message}</p>
                        <span class="message-time">${timestamp}</span>
                    </div>
                `;
                
                messagesBody.appendChild(msgDiv);
            });
            
            // Scroll to bottom
            messagesBody.scrollTop = messagesBody.scrollHeight;
            
            // Mark messages as read
            await markMessagesRead();
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

async function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    
    if (!message || !currentChatUser) return;
    
    try {
        const response = await fetch(`${API_URL}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender: currentUser.gmail,
                recipient: currentChatUser,
                message: message
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            messageInput.value = '';
            await loadMessages();
        } else {
            alert('Error sending message: ' + data.message);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Error sending message');
    }
}

function handleMessageKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

async function markMessagesRead() {
    if (!currentChatUser) return;
    
    try {
        await fetch(`${API_URL}/mark-messages-read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user1: currentUser.gmail,
                user2: currentChatUser
            })
        });
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

async function messageOwner() {
    if (!currentUser) {
        alert('Please login first');
        return;
    }
    
    try {
        // Fetch the owner's Gmail from the backend
        const response = await fetch(`${API_URL}/get-owner-gmail`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const ownerGmail = data.gmail;
            
            // Check if user is trying to message themselves
            if (ownerGmail === currentUser.gmail) {
                alert('You are the owner! You cannot message yourself.');
                return;
            }
            
            // Open chat with owner
            await openChat(ownerGmail);
        } else {
            alert('Could not find owner. Please try again.');
        }
    } catch (error) {
        console.error('Error fetching owner Gmail:', error);
        alert('Error connecting to owner. Please try again.');
    }
}

// ===== PROFILE FUNCTIONS =====

async function loadUserProfile() {
    if (!currentUser || !currentUser.gmail) return;

    // Capture logout version at the start; if user logs out while fetch is in-flight,
    // we must not update the UI.
    const startLogoutVersion = logoutVersion;

    try {
        const response = await fetch(`${API_URL}/get-user-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail: currentUser.gmail })
        });
        const data = await response.json();

        if (logoutVersion !== startLogoutVersion) return; // stale response
        if (!currentUser || !currentUser.gmail) return;

        if (data.success) {
            // Update profile page
            document.getElementById('profile-username').textContent = data.username || 'User';
            document.getElementById('profile-gmail').textContent = data.gmail;

            // Format creation date
            if (data.created_at) {
                const createdDate = new Date(data.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                document.getElementById('profile-member-since').textContent = `Member since ${createdDate}`;
            }

            // Update profile avatar
            if (data.profile_image) {
                document.getElementById('profile-avatar').src = `/static/images/${data.profile_image}`;
                // Also update nav button image
                const navProfileImage = document.getElementById('nav-profile-image');
                if (navProfileImage) {
                    navProfileImage.src = `/static/images/${data.profile_image}`;
                }
            } else {
                document.getElementById('profile-avatar').src = '/static/images/default-avatar.svg';
                // Also update nav button image
                const navProfileImage = document.getElementById('nav-profile-image');
                if (navProfileImage) {
                    navProfileImage.src = '/static/images/default-avatar.svg';
                }
            }

            // Update nav button username
            document.getElementById('user-gmail').textContent = data.username || data.gmail;

            // Load profile stats
            await loadProfileStats();
        }
    } catch (error) {
        console.error('Error loading user profile:', error);
    }
}

async function loadProfileStats() {
    if (!currentUser || !currentUser.gmail) return;
    
    try {
        const response = await fetch(`${API_URL}/get-customer-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_gmail: currentUser.gmail })
        });
        const data = await response.json();
        
        if (data.success && data.orders) {
            const orders = data.orders;
            const deliveredOrders = orders.filter(o => o.status === 'delivered');
            const totalSpent = deliveredOrders.reduce((sum, o) => sum + (o.total || 0), 0);
            
            document.getElementById('total-orders-count').textContent = orders.length;
            document.getElementById('delivered-count-stat').textContent = deliveredOrders.length;
            document.getElementById('total-spent-stat').textContent = `₱${totalSpent.toLocaleString()}`;
        }
    } catch (error) {
        console.error('Error loading profile stats:', error);
    }
}

function triggerProfileImageUpload() {
    document.getElementById('profile-image-input').click();
}

function previewProfileImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('profile-avatar').src = e.target.result;
        };
        reader.readAsDataURL(file);
        
        // Show confirmation to save
        if (confirm('Update your profile picture?')) {
            saveProfileImage(file);
        }
    }
}

async function saveProfileImage(file) {
    if (!currentUser || !currentUser.gmail) return;
    
    try {
        const formData = new FormData();
        formData.append('gmail', currentUser.gmail);
        formData.append('profile_image', file);
        
        const response = await fetch(`${API_URL}/update-user-profile`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Profile picture updated successfully!');
            loadUserProfile(); // Reload profile
        } else {
            alert('Error updating profile picture: ' + (data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving profile image:', error);
        alert('Error saving profile image. Please try again.');
    }
}

function openEditUsernameModal() {
    document.getElementById('edit-username-modal').style.display = 'flex';
    document.getElementById('username-input').value = document.getElementById('profile-username').textContent;
    document.getElementById('username-input').focus();
}

function closeEditUsernameModal() {
    document.getElementById('edit-username-modal').style.display = 'none';
}

async function saveUsername() {
    if (!currentUser || !currentUser.gmail) return;
    
    const username = document.getElementById('username-input').value.trim();
    
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    if (username.length > 30) {
        alert('Username must be 30 characters or less');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('gmail', currentUser.gmail);
        formData.append('username', username);
        
        const response = await fetch(`${API_URL}/update-user-profile`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Username updated successfully!');
            closeEditUsernameModal();
            loadUserProfile();
        } else {
            alert('Error updating username: ' + (data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving username:', error);
        alert('Error saving username. Please try again.');
    }
}

function openChangePasswordModal() {
    document.getElementById('change-password-modal').style.display = 'flex';
    // Reset to step 1
    document.getElementById('password-change-step-1').style.display = 'block';
    document.getElementById('password-change-step-2').style.display = 'none';
    document.getElementById('otp-input').value = '';
    document.getElementById('new-password-input').value = '';
    document.getElementById('confirm-password-input').value = '';
}

function closeChangePasswordModal() {
    document.getElementById('change-password-modal').style.display = 'none';
}

async function requestPasswordChangeOTP() {
    if (!currentUser || !currentUser.gmail) return;
    
    try {
        const response = await fetch(`${API_URL}/request-password-change-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gmail: currentUser.gmail })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('OTP sent to your email! Check your inbox.');
            // Move to step 2
            document.getElementById('password-change-step-1').style.display = 'none';
            document.getElementById('password-change-step-2').style.display = 'block';
            document.getElementById('otp-input').focus();
        } else {
            alert('Error sending OTP: ' + (data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error requesting OTP:', error);
        alert('Error sending OTP. Please try again.');
    }
}

async function verifyOTPAndChangePassword() {
    if (!currentUser || !currentUser.gmail) return;
    
    const otp = document.getElementById('otp-input').value.trim();
    const newPassword = document.getElementById('new-password-input').value;
    const confirmPassword = document.getElementById('confirm-password-input').value;
    
    if (!otp || !newPassword || !confirmPassword) {
        alert('Please fill in all fields');
        return;
    }
    
    if (otp.length !== 6 || isNaN(otp)) {
        alert('OTP must be 6 digits');
        return;
    }
    
    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/verify-password-change-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                gmail: currentUser.gmail,
                otp: otp,
                new_password: newPassword
            })
        });
        const data = await response.json();
        
        if (data.success) {
            alert('Password changed successfully! Please log in again.');
            closeChangePasswordModal();
            confirmLogout();
        } else {
            alert('Error changing password: ' + (data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error verifying OTP:', error);
        alert('Error changing password. Please try again.');
    }
}

// Initialize profile on page load if user is logged in
window.addEventListener('load', function() {
    if (currentUser && currentUser.gmail) {
        loadUserProfile();
    }
});

