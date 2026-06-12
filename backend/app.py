from flask import Flask, request, jsonify, send_from_directory
from flask_mail import Mail, Message
from pymongo import MongoClient
from bson.objectid import ObjectId
from datetime import datetime, timedelta
from PIL import Image
import imagehash
import tempfile
import os
from functools import wraps
import sys
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from itsdangerous import URLSafeTimedSerializer
import uuid
import random
import string


load_dotenv()


UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'images')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

app = Flask(__name__, static_folder='../static', template_folder='../frontend')

# Flask-Mail Configuration
app.config['MAIL_SERVER'] = os.getenv('MAIL_SERVER', 'smtp.gmail.com')
app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.getenv('MAIL_USE_TLS', 'True') == 'True'
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME', '')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD', '')
app.config['MAIL_DEFAULT_SENDER'] = os.getenv('MAIL_DEFAULT_SENDER', '')

mail = Mail(app)

# OTP Configuration
OTP_EXPIRY_MINUTES = int(os.getenv('OTP_EXPIRY_MINUTES', 10))
OTP_LENGTH = int(os.getenv('OTP_LENGTH', 6))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), 'frontend')
STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), 'static')


MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/')
MONGODB_DATABASE = os.getenv('MONGODB_DATABASE', 'juana_ribbon')


client = MongoClient(MONGODB_URI)
db = client[MONGODB_DATABASE]

print("\nConnected to MongoDB: " + MONGODB_DATABASE)

users_collection = db['users']
products_collection = db['products']
orders_collection = db['orders']
inventory_collection = db['inventory']
login_history_collection = db['login_history']
categories_collection = db['categories']
messages_collection = db['messages']
otp_collection = db['otp_tokens']
notifications_collection = db['notifications']
return_requests_collection = db['return_requests']

PRODUCT_HASHES = {}

# Store last recommendation per session to handle "more" requests
chat_sessions = {}

def generate_otp(length=OTP_LENGTH):
    """Generate a random OTP code"""
    return ''.join(random.choices(string.digits, k=length))

def send_otp_email(email, otp, purpose='registration'):
    """Send OTP via email"""
    try:
        if purpose == 'registration':
            subject = 'Juana\'s Ribbon - Email Verification OTP'
            body = f"""
Hi there!

Welcome to Juana's Ribbon! To complete your registration, please use the following OTP code:

OTP CODE: {otp}

This code will expire in {OTP_EXPIRY_MINUTES} minutes.

If you didn't request this code, please ignore this email.

Best regards,
Juana's Ribbon Team
            """
        elif purpose == 'change_email':
            subject = 'Juana\'s Ribbon - Email Change Verification OTP'
            body = f"""
Hi there!

To change your email address, please use the following OTP code:

OTP CODE: {otp}

This code will expire in {OTP_EXPIRY_MINUTES} minutes.

If you didn't request this change, please ignore this email and contact support.

Best regards,
Juana's Ribbon Team
            """
        elif purpose == 'password_change':
            subject = 'Juana\'s Ribbon - Password Change OTP'
            body = f"""
Hi there!

To change your password, please use the following OTP code:

OTP CODE: {otp}

This code will expire in {OTP_EXPIRY_MINUTES} minutes.

If you didn't request this change, please ignore this email and contact support immediately.

Best regards,
Juana's Ribbon Team
            """
        else:
            return False
        
        msg = Message(
            subject=subject,
            recipients=[email],
            body=body
        )
        mail.send(msg)
        return True
    except Exception as e:
        print(f"Error sending OTP email to {email}: {str(e)}")
        return False

def save_otp(email, otp, purpose='registration'):
    """Save OTP to database with expiry"""
    expiry_time = datetime.now() + timedelta(minutes=OTP_EXPIRY_MINUTES)
    
    # Remove any existing OTP for this email and purpose
    otp_collection.delete_many({'email': email, 'purpose': purpose})
    
    # Save new OTP
    otp_collection.insert_one({
        'email': email,
        'otp': otp,
        'purpose': purpose,
        'created_at': datetime.now().isoformat(),
        'expiry': expiry_time.isoformat(),
        'verified': False
    })

def verify_otp(email, otp, purpose='registration'):
    """Verify OTP from database"""
    otp_record = otp_collection.find_one({'email': email, 'otp': otp, 'purpose': purpose})
    
    if not otp_record:
        return False, 'Invalid OTP'
    
    # Check if OTP has expired
    expiry_time = datetime.fromisoformat(otp_record['expiry'])
    if datetime.now() > expiry_time:
        return False, 'OTP has expired'
    
    # Mark as verified
    otp_collection.update_one(
        {'_id': otp_record['_id']},
        {'$set': {'verified': True}}
    )
    
    return True, 'OTP verified successfully'

def seed_data():
    
   
    owner_user = users_collection.find_one({'role': 'owner'})
    if not owner_user:
        hashed_password = generate_password_hash('admin123')
        users_collection.insert_one({'gmail': 'admin@gmail.com', 'password': hashed_password, 'role': 'owner'})
        print("Owner account created: admin@gmail.com / admin123")
    
   
    if products_collection.count_documents({}) == 0:
        products = [
            {
                'category': 'SATIN RIBBON FLOWERS',
                'name': 'Ribbon Rose',
                'prices': {'1': 149, '3': 299, '5': 449, '12': 849},
                'colors': ['MILKY WHITE', 'ROYAL BLUE', 'GOLDEN YELLOW', 'BARBIE PINK', 'LIGHT PURPLE', 'RED', 'BLACK', 'BROWN', 'DEEP ROSE RED', 'PEACH', 'WHITE', 'LIGHT PINK', 'LIGHT BLUE', 'YELLOW', 'LIGHT GOLD'],
                'image': 'ribbon-rose.jpg'
            },
            {
                'category': 'SATIN RIBBON FLOWERS',
                'name': 'Ribbon Sunflower',
                'prices': {'1': 179, '3': 449, '5': 529},
                'colors': ['MILKY WHITE', 'ROYAL BLUE', 'GOLDEN YELLOW', 'BARBIE PINK', 'LIGHT PURPLE', 'RED', 'BLACK', 'BROWN', 'DEEP ROSE RED', 'PEACH', 'WHITE', 'LIGHT PINK', 'LIGHT BLUE', 'YELLOW', 'LIGHT GOLD'],
                'image': 'ribbon-sunflower.jpg'
            },
            {
                'category': 'SATIN RIBBON FLOWERS',
                'name': 'Ribbon Tulips',
                'prices': {'1': 149, '3': 299, '5': 449, '12': 849},
                'colors': ['MILKY WHITE', 'ROYAL BLUE', 'GOLDEN YELLOW', 'BARBIE PINK', 'LIGHT PURPLE', 'RED', 'BLACK', 'BROWN', 'DEEP ROSE RED', 'PEACH', 'WHITE', 'LIGHT PINK', 'LIGHT BLUE', 'YELLOW', 'LIGHT GOLD'],
                'image': 'ribbon-tulips.jpg'
            },
            {
                'category': 'LOVER INSPIRED BOUQUET',
                'name': 'Lover Bouquet',
                'prices': {'1': 169, '3': 349, '5': 549, '6': 629, '12': 949, '18': 1589},
                'colors': ['MILKY WHITE', 'LIGHT PINK', 'LIGHT BLUE', 'PINK', 'WHITE'],
                'addons': {'FAIRY LIGHTS': 25, 'DRIED FLOWERS': 40},
                'image': 'lover-bouquet.jpg'
            },
            {
                'category': 'FUZZY WIRE BOUQUET',
                'name': 'Fuzzy Lily',
                'prices': {'1': 149, '3': 299, '5': 449, '12': 849},
                'colors': ['WHITE', 'ROYAL BLUE', 'EGG YELLOW', 'ROSE RED', 'LIGHT PURPLE', 'RED', 'PINK', 'GRASS GREEN', 'BLUE', 'LIGHT PINK'],
                'image': 'fuzzy-lily.jpg'
            },
            {
                'category': 'FUZZY WIRE BOUQUET',
                'name': 'Fuzzy Tulips',
                'prices': {'1': 149, '3': 299, '5': 449, '12': 849},
                'colors': ['WHITE', 'ROYAL BLUE', 'EGG YELLOW', 'ROSE RED', 'LIGHT PURPLE', 'RED', 'PINK', 'GRASS GREEN', 'BLUE', 'LIGHT PINK'],
                'image': 'fuzzy-tulips.jpg'
            },
            {
                'category': 'FUZZY WIRE BOUQUET',
                'name': 'Tangled Bouquet',
                'prices': {'1': 169, '3': 319, '5': 469, '8': 699},
                'colors': ['WHITE', 'ROYAL BLUE', 'EGG YELLOW', 'ROSE RED', 'LIGHT PURPLE', 'RED', 'PINK', 'GRASS GREEN', 'BLUE', 'LIGHT PINK'],
                'image': 'tangled-bouquet.jpg'
            },
            {
                'category': 'BUTTERFLY BOUQUET',
                'name': 'Butterfly Bouquet',
                'prices': {'10': 289, '20': 429, '25': 469},
                'colors': ['PINK', 'BLUE', 'PURPLE', 'WHITE', 'ORANGE', 'RAINBOW'],
                'addons': {'FAIRY LIGHTS': 25, 'DRIED FLOWERS': 40},
                'image': 'butterfly-bouquet.jpg'
            },
            {
                'category': 'MINI DONUTS',
                'name': 'Classic Donut',
                'prices': {'6': 60, '12': 130},
                'flavors': ['CHOCOLATE', 'WHITE CHOCOLATE', 'STRAWBERRY', 'MATCHA', 'CHOCO SPRINKLES', 'WHITE SPRINKLES', 'STRAWBERRY SPRINKLES', 'MATCHA SPRINKLES', 'CHOCO MALLOWS', 'WHITE MALLOWS', 'STRAWBERRY MALLOWS', 'MATCHA MALLOWS', 'CHOCO CRISP', 'WHITE CRISP', 'STRAWBERRY CRISP', 'MATCHA CRISP'],
                'image': 'classic-donut.jpg'
            },
            {
                'category': 'MINI DONUTS',
                'name': 'Premium Donut',
                'prices': {'6': 70, '12': 150},
                'flavors': ['CHOCOLATE ALMOND', 'WHITE ALMOND', 'STRAWBERRY ALMOND', 'MATCHA ALMOND', 'CHOCO OREO', 'COOKIES N CREAM', 'STRAWBERRY OREO', 'MATCHA OREO'],
                'image': 'premium-donut.jpg'
            },
            {
                'category': 'MINI DONUTS',
                'name': 'Party Set',
                'prices': {'6': 75, '12': 150, '25': 300},
                'flavors': ['CHOCOLATE', 'WHITE CHOCOLATE', 'STRAWBERRY', 'MATCHA', 'CHOCO SPRINKLES', 'WHITE SPRINKLES', 'STRAWBERRY SPRINKLES', 'MATCHA SPRINKLES', 'CHOCO MALLOWS', 'WHITE MALLOWS', 'STRAWBERRY MALLOWS', 'MATCHA MALLOWS', 'CHOCO CRISP', 'WHITE CRISP', 'STRAWBERRY CRISP', 'MATCHA CRISP', 'CHOCOLATE ALMOND', 'WHITE ALMOND', 'STRAWBERRY ALMOND', 'MATCHA ALMOND', 'CHOCO OREO', 'COOKIES N CREAM', 'STRAWBERRY OREO', 'MATCHA OREO'],
                'image': 'party-set.jpg'
            }
        ]
        products_collection.insert_many(products)
    
    
    if inventory_collection.count_documents({}) == 0:
        products = list(products_collection.find())
        inventory_list = []
        for p in products:
            variants = p.get('colors', []) or p.get('flavors', [])
            
            for variant in variants:
                inventory_list.append({
                    'product_id': str(p['_id']),
                    'product_name': p['name'],
                    'variant': variant,
                    'stock': 50,
                    'reserved': 0,
                    'sold': 0,
                    'available': True,
                    'last_updated': datetime.now().isoformat()
                })
        
        if not inventory_list:
            for p in products:
                inventory_list.append({
                    'product_id': str(p['_id']),
                    'product_name': p['name'],
                    'variant': 'DEFAULT',
                    'stock': 50,
                    'reserved': 0,
                    'sold': 0,
                    'available': True,
                    'last_updated': datetime.now().isoformat()
                })
        
        inventory_collection.insert_many(inventory_list)
    
    
    if categories_collection.count_documents({}) == 0:
        default_categories = [
            {'name': 'SATIN RIBBON FLOWERS', 'created_at': datetime.now().isoformat()},
            {'name': 'LOVER INSPIRED BOUQUET', 'created_at': datetime.now().isoformat()},
            {'name': 'FUZZY WIRE BOUQUET', 'created_at': datetime.now().isoformat()},
            {'name': 'BUTTERFLY BOUQUET', 'created_at': datetime.now().isoformat()},
            {'name': 'MINI DONUTS', 'created_at': datetime.now().isoformat()}
        ]
        categories_collection.insert_many(default_categories)
        print("Default categories created")

    global PRODUCT_HASHES
    PRODUCT_HASHES.clear() 
    products = list(products_collection.find({}, {'image': 1, 'name': 1}))
    static_images_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'images')
    
    print(f"\nPrecomputing {len(products)} product image hashes...")
    for product in products:
        image_filename = product['image']
        image_path = os.path.join(static_images_dir, image_filename)
        if os.path.exists(image_path):
            try:
                with Image.open(image_path) as img:
                    if img.mode not in ('RGB', 'L'):
                        img = img.convert('RGB')
                    hash_val = imagehash.average_hash(img)
                    PRODUCT_HASHES[image_filename] = {'hash': str(hash_val), 'name': product['name']}
                    print(f"  [OK] Hashed {image_filename}: {product['name']}")
            except Exception as e:
                print(f"  [FAIL] Error hashing {image_filename}: {e}")
        else:
            print(f"  [FAIL] Image not found: {image_path}")
    print(f"Product image hashes precomputed. Total: {len(PRODUCT_HASHES)} products ready for matching")

def validate_schedule(date_str, time_str):
    try:
        dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        if dt < datetime.now():
            return False, "Cannot schedule in past"
        return True, dt.isoformat()
    except:
        return False, "Invalid format"

def update_product_hash(product_name, image_filename):
    """Update the hash for a single product. Called when new products are added."""
    global PRODUCT_HASHES
    try:
        image_path = os.path.join(UPLOAD_FOLDER, image_filename)
        print(f"\n[HASH] Computing hash for new product: {product_name}")
        print(f"[HASH] Image path: {image_path}")
        print(f"[HASH] Image exists: {os.path.exists(image_path)}")
        
        if os.path.exists(image_path):
            with Image.open(image_path) as img:
                print(f"[HASH] Original image mode: {img.mode}, size: {img.size}")
                # Ensure consistent image format
                if img.mode not in ('RGB', 'L'):
                    img = img.convert('RGB')
                    print(f"[HASH] Converted to RGB")
                hash_val = imagehash.average_hash(img)
                PRODUCT_HASHES[image_filename] = {'hash': str(hash_val), 'name': product_name}
                print(f"[OK] Added hash for new product: {product_name}")
                print(f"[HASH] Hash value: {str(hash_val)}")
                print(f"[HASH] Total products in hashes: {len(PRODUCT_HASHES)}")
                return True
        else:
            print(f"[FAIL] Image not found for product {product_name}: {image_path}")
            return False
    except Exception as e:
        print(f"[FAIL] Error hashing product {product_name}: {e}")
        import traceback
        traceback.print_exc()
        return False

def get_date_filter(period):
    now = datetime.now()
    if period == 'weekly':
        return now - timedelta(days=7)
    elif period == 'monthly':
        return now - timedelta(days=30)
    elif period == '6months':
        return now - timedelta(days=180)
    elif period == 'yearly':
        return now - timedelta(days=365)
    return datetime(2020, 1, 1)

@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/index.html')
@app.route('/home')
def home():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/frontend/<path:filename>')
def serve_frontend_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory(STATIC_DIR, path)

@app.route('/customer-register', methods=['POST'])
def customer_register():
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    password = data.get('password', '')
    confirm_password = data.get('confirm_password', '')
    
    if not gmail.endswith('@gmail.com'):
        return jsonify({'success': False, 'message': 'Please use a valid Gmail address'})
    
    if not password:
        return jsonify({'success': False, 'message': 'Password is required'})
    
    if len(password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters'})
    
    if password != confirm_password:
        return jsonify({'success': False, 'message': 'Passwords do not match'})
    
    # Check if email already registered
    existing_user = users_collection.find_one({'gmail': gmail})
    if existing_user:
        return jsonify({'success': False, 'message': 'Account already exists with this Gmail'})
    
    # Generate and send OTP
    otp = generate_otp()
    save_otp(gmail, otp, purpose='registration')
    
    # Send OTP email
    email_sent = send_otp_email(gmail, otp, purpose='registration')
    
    if not email_sent:
        return jsonify({'success': False, 'message': 'Failed to send OTP email. Please try again.'})
    
    # Store temporary registration data (will be deleted after verification)
    temp_data = {
        'gmail': gmail,
        'password': generate_password_hash(password),
        'created_at': datetime.now().isoformat()
    }
    
    # Store in a temporary collection or in user pending field
    users_collection.insert_one({
        'gmail': gmail,
        'password': temp_data['password'],
        'role': 'customer',
        'status': 'pending_verification',
        'created_at': temp_data['created_at']
    })
    
    return jsonify({
        'success': True,
        'message': 'OTP sent to your email. Please verify to complete registration.',
        'gmail': gmail
    })

@app.route('/verify-registration-otp', methods=['POST'])
def verify_registration_otp():
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    otp = data.get('otp', '').strip()
    
    if not gmail or not otp:
        return jsonify({'success': False, 'message': 'Gmail and OTP are required'})
    
    # Verify OTP
    is_valid, message = verify_otp(gmail, otp, purpose='registration')
    
    if not is_valid:
        return jsonify({'success': False, 'message': message})
    
    # Update user status to verified
    result = users_collection.update_one(
        {'gmail': gmail, 'status': 'pending_verification'},
        {'$set': {'status': 'verified'}}
    )
    
    if result.modified_count == 0:
        return jsonify({'success': False, 'message': 'Registration not found or already verified'})
    
    # Get the user ID
    user = users_collection.find_one({'gmail': gmail})
    
    return jsonify({
        'success': True,
        'message': 'Registration verified successfully!',
        'gmail': gmail,
        'user_id': str(user['_id']) if user else None
    })

@app.route('/customer-login', methods=['POST'])
def customer_login():
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    password = data.get('password', '')
    
    if not gmail.endswith('@gmail.com'):
        return jsonify({'success': False, 'message': 'Please use a valid Gmail address'})
    
    if not password:
        return jsonify({'success': False, 'message': 'Password is required'})
    
    existing_user = users_collection.find_one({'gmail': gmail})
    
    
    if not existing_user:
        return jsonify({'success': False, 'message': 'Account not found. Please register first.'})
    
    # Check if account is verified
    if existing_user.get('status') == 'pending_verification':
        return jsonify({'success': False, 'message': 'Please verify your email first to login.'})
   
    if not check_password_hash(existing_user.get('password', ''), password):
        return jsonify({'success': False, 'message': 'Invalid password'})
    
    
    login_record = {
        'gmail': gmail,
        'login_time': datetime.now().isoformat(),
        'login_date': datetime.now().strftime("%Y-%m-%d")
    }
    login_history_collection.insert_one(login_record)
    
    return jsonify({'success': True, 'gmail': gmail, 'role': existing_user.get('role', 'customer')})

# ===== USER PROFILE ENDPOINTS =====

@app.route('/get-user-profile', methods=['POST'])
def get_user_profile():
    """Get user profile information"""
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    
    if not gmail:
        return jsonify({'success': False, 'message': 'Gmail required'})
    
    user = users_collection.find_one({'gmail': gmail})
    
    if not user:
        return jsonify({'success': False, 'message': 'User not found'})
    
    return jsonify({
        'success': True,
        'gmail': user.get('gmail'),
        'username': user.get('username', 'User'),
        'profile_image': user.get('profile_image', None),
        'created_at': user.get('created_at', '')
    })

@app.route('/update-user-profile', methods=['POST'])
def update_user_profile():
    """Update user profile (username and/or profile image)"""
    try:
        gmail = request.form.get('gmail', '').strip().lower()
        username = request.form.get('username', '').strip()
        
        if not gmail:
            return jsonify({'success': False, 'message': 'Gmail required'})
        
        user = users_collection.find_one({'gmail': gmail})
        if not user:
            return jsonify({'success': False, 'message': 'User not found'})
        
        # Handle profile image upload
        profile_image_filename = user.get('profile_image')
        
        if 'profile_image' in request.files:
            file = request.files['profile_image']
            if file and file.filename != '' and allowed_file(file.filename):
                # Delete old profile image if exists
                if profile_image_filename and profile_image_filename not in ['default-avatar.png', 'default-avatar.svg']:
                    old_path = os.path.join(UPLOAD_FOLDER, profile_image_filename)
                    if os.path.exists(old_path):
                        try:
                            os.remove(old_path)
                        except:
                            pass
                
                # Save new profile image
                ext = file.filename.rsplit('.', 1)[1].lower()
                unique_filename = f"profile_{uuid.uuid4().hex}.{ext}"
                os.makedirs(UPLOAD_FOLDER, exist_ok=True)
                file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
                file.save(file_path)
                profile_image_filename = unique_filename
        
        # Update user data
        update_data = {}
        if username:
            update_data['username'] = username
        if profile_image_filename:
            update_data['profile_image'] = profile_image_filename
        
        if update_data:
            users_collection.update_one(
                {'gmail': gmail},
                {'$set': update_data}
            )
        
        return jsonify({
            'success': True,
            'message': 'Profile updated successfully',
            'username': username or user.get('username', 'User'),
            'profile_image': profile_image_filename
        })
    
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error updating profile: {str(e)}'})

@app.route('/request-password-change-otp', methods=['POST'])
def request_password_change_otp():
    """Send OTP to user's email for password change"""
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    
    if not gmail:
        return jsonify({'success': False, 'message': 'Gmail required'})
    
    if not gmail.endswith('@gmail.com'):
        return jsonify({'success': False, 'message': 'Please use a valid Gmail address'})
    
    user = users_collection.find_one({'gmail': gmail})
    
    if not user:
        return jsonify({'success': False, 'message': 'User not found'})
    
    # Generate and send OTP
    otp = generate_otp()
    save_otp(gmail, otp, purpose='password_change')
    
    # Send OTP email
    email_sent = send_otp_email(gmail, otp, purpose='password_change')
    
    if not email_sent:
        return jsonify({'success': False, 'message': 'Failed to send OTP email. Please try again.'})
    
    return jsonify({
        'success': True,
        'message': f'OTP sent to {gmail}. Please check your email.',
        'gmail': gmail
    })

@app.route('/verify-password-change-otp', methods=['POST'])
def verify_password_change_otp():
    """Verify OTP and change password"""
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    otp = data.get('otp', '').strip()
    new_password = data.get('new_password', '')
    
    if not gmail or not otp or not new_password:
        return jsonify({'success': False, 'message': 'Gmail, OTP, and new password are required'})
    
    if len(new_password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters'})
    
    # Verify OTP
    is_valid, message = verify_otp(gmail, otp, purpose='password_change')
    
    if not is_valid:
        return jsonify({'success': False, 'message': message})
    
    # Check if user exists
    user = users_collection.find_one({'gmail': gmail})
    
    if not user:
        return jsonify({'success': False, 'message': 'User not found'})
    
    # Update password
    hashed_password = generate_password_hash(new_password)
    
    users_collection.update_one(
        {'gmail': gmail},
        {'$set': {'password': hashed_password}}
    )
    
    return jsonify({
        'success': True,
        'message': 'Password changed successfully!',
        'gmail': gmail
    })

@app.route('/load-cart', methods=['POST'])
def load_cart():
    data = request.json
    gmail = data.get('gmail')
    
    user = users_collection.find_one({'gmail': gmail})
    cart = user.get('cart', []) if user else []
    removed_products = user.get('removed_products', []) if user else []
    return jsonify({'success': True, 'cart': cart, 'removed_products': removed_products})

@app.route('/get-customer-history', methods=['POST'])
def get_customer_history():
    data = request.json
    gmail = data.get('gmail')

    if not gmail:
        return jsonify({'success': False, 'message': 'Gmail required'})

    user = users_collection.find_one({'gmail': gmail})
    removed_products = user.get('removed_products', []) if user else []

    customer_orders = orders_collection.find({'customer_gmail': gmail})
    ordered_products = set()

    for order in customer_orders:
        for item in order.get('items', []):
            product_name = item.get('name', '')
            if product_name:
                ordered_products.add(product_name)

    return jsonify({
        'success': True,
        'ordered_products': list(ordered_products),
        'removed_products': removed_products
    })

@app.route('/get-customer-orders', methods=['POST'])
def get_customer_orders():
    data = request.json
    gmail = data.get('customer_gmail')
    if not gmail:
        return jsonify({'success': False, 'message': 'Gmail required'})
    
    customer_orders = list(orders_collection.find({
        'customer_gmail': gmail
    }).sort('created_at', -1))
    
    for order in customer_orders:
        order['_id'] = str(order['_id'])
        if 'created_at' in order:
            order['formatted_date'] = datetime.fromisoformat(order['created_at']).strftime('%Y-%m-%d %H:%M')
        else:
            order['formatted_date'] = 'N/A'
    
    return jsonify({
        'success': True,
        'orders': customer_orders
    })
    
    if not gmail:
        return jsonify({'success': False, 'message': 'Gmail required'})
    
    
    user = users_collection.find_one({'gmail': gmail})
    removed_products = user.get('removed_products', []) if user else []
    
    
    customer_orders = orders_collection.find({'customer_gmail': gmail})
    ordered_products = set()
    
    for order in customer_orders:
        for item in order.get('items', []):
            product_name = item.get('name', '')
            if product_name:
                ordered_products.add(product_name)
    
    return jsonify({
        'success': True,
        'ordered_products': list(ordered_products),
        'removed_products': removed_products
    })

@app.route('/owner-login', methods=['POST'])
def owner_login():
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    password = data.get('password', '')
    
    if not gmail.endswith('@gmail.com'):
        return jsonify({'success': False, 'message': 'Please use a valid Gmail address'})
    
    user = users_collection.find_one({'gmail': gmail})
    if user and user.get('role') == 'owner':
      
        if check_password_hash(user.get('password', ''), password):
            return jsonify({'success': True, 'gmail': gmail, 'role': 'owner'})
    
    return jsonify({'success': False, 'message': 'Invalid credentials'})

@app.route('/products', methods=['GET'])
def get_products():
    products = list(products_collection.find({}, {'_id': 0}))
    return jsonify({'success': True, 'products': products})

@app.route('/orders', methods=['POST'])
def place_order():
    data = request.json
    
    for item in data.get('items', []):
        product_name = item.get('name')
        variant = item.get('variant', 'DEFAULT')
        quantity = int(item.get('quantity', 1))
        
        inv = inventory_collection.find_one({
            'product_name': product_name, 
            'variant': variant
        })
        
        if not inv or not inv.get('available', True):
            return jsonify({'success': False, 'message': f'{variant} is currently unavailable'})
    
    order_id_num = orders_collection.count_documents({}) + 1
    order_id = f"#{order_id_num:04d}"
    
    
    now = datetime.now()
    order_date = now.strftime("%Y-%m-%d")
    
    subtotal = data.get('subtotal', 0)
    delivery_fee = data.get('delivery_fee', 0)
    total = data.get('total', 0)
    
    order = {
        'order_id': order_id,
        'customer_gmail': data.get('customer_gmail'),
        'items': data.get('items', []),
        'subtotal': subtotal,
        'delivery_fee': delivery_fee,
        'total': total,
        'method': data.get('method', 'pickup'),
        'address': data.get('address', ''),
        'time': data.get('time', ''),
        'payment': data.get('payment', 'cash'),
        'date': order_date,
        'created_at': now.isoformat(),
        'status': 'pending'
    }
    
    order_id_result = orders_collection.insert_one(order).inserted_id
    
    for item in data.get('items', []):
        product_name = item.get('name')
        variant = item.get('variant', 'DEFAULT')
        quantity = int(item.get('quantity', 1))
        
        inventory_collection.update_one(
            {'product_name': product_name, 'variant': variant},
            {'$inc': {'stock': -quantity, 'sold': quantity}}
        )
    
    return jsonify({'success': True, 'order_id': order_id, 'date': order_date})

def parse_quantity(quantity_value):
    """Parse quantity value, handling cases like '3pcs' or '3 pcs'"""
    if isinstance(quantity_value, int):
        return quantity_value
    if isinstance(quantity_value, str):
        import re
        numbers = re.findall(r'\d+', quantity_value)
        if numbers:
            return int(numbers[0])
    return 1


@app.route('/calendar-order', methods=['POST'])
def calendar_order():
    data = request.json
    date = data.get('date', '')
    time = data.get('time', '')
    is_valid, result = validate_schedule(date, time)
    if not is_valid:
        return jsonify({'success': False, 'message': result})
    
    order_id_num = orders_collection.count_documents({}) + 1
    order_id = f"#{order_id_num:04d}"
    
    order = {
        'order_id': order_id,
        'customer_gmail': data.get('customer_gmail'),
        'items': data.get('items', []),
        'subtotal': data.get('subtotal', 0),
        'delivery_fee': data.get('delivery_fee', 0),
        'total': data.get('total', 0),
        'method': data.get('method', 'pickup'),
        'address': data.get('address', ''),
        'scheduled_date': date,
        'scheduled_time': time,
        'scheduled_datetime': result,
        'payment': data.get('payment', 'cash'),
        'date': datetime.now().strftime("%Y-%m-%d"),
        'created_at': datetime.now().isoformat(),
        'status': 'scheduled'
    }
    
    orders_collection.insert_one(order)
    
    for item in data.get('items', []):
        product_name = item.get('name')
        variant = item.get('variant', 'DEFAULT')
        quantity = parse_quantity(item.get('quantity', 1))
        inventory_collection.update_one(
            {'product_name': product_name, 'variant': variant},
            {'$inc': {'stock': -quantity}}
        )
    
    return jsonify({'success': True, 'order_id': order_id})

@app.route('/update-order-status', methods=['POST'])
def update_order_status():
    data = request.json
    order_id = data.get('order_id')
    new_status = data.get('status')
    cancel_reason = data.get('cancel_reason', '')
    
    valid_statuses = ['payment_pending', 'payment_confirmed', 'production', 'done', 'cancelled', 'pending', 'delivered', 'scheduled']
    if new_status not in valid_statuses:
        return jsonify({'success': False, 'message': 'Invalid status'})
    
    # Get the current order to know customer details
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        return jsonify({'success': False, 'message': 'Order not found'})
    
    update_data = {'status': new_status}
    if new_status == 'cancelled' and cancel_reason:
        update_data['cancel_reason'] = cancel_reason
    
    result = orders_collection.update_one(
        {'order_id': order_id},
        {'$set': update_data}
    )
    
    # Create notifications based on status change
    if result.modified_count > 0:
        customer_email = order.get('customer_gmail')
        
        # Notify customer when order is done (ready for pickup)
        if new_status == 'done':
            notification_message = f"Your order {order_id} is ready! Click to view details."
            notifications_collection.insert_one({
                'recipient': customer_email,
                'type': 'order_ready',
                'order_id': order_id,
                'message': notification_message,
                'status': 'done',
                'created_at': datetime.now().isoformat(),
                'read': False
            })
        
        # Notify owner when customer confirms delivery
        elif new_status == 'delivered':
            # Get owner's email (assuming owner is stored in a config or we use default)
            owner = users_collection.find_one({'role': 'owner'})
            if owner:
                owner_email = owner.get('gmail')
                notification_message = f"Customer {customer_email} confirmed delivery for order {order_id}."
                notifications_collection.insert_one({
                    'recipient': owner_email,
                    'type': 'order_received',
                    'order_id': order_id,
                    'customer': customer_email,
                    'message': notification_message,
                    'status': 'delivered',
                    'created_at': datetime.now().isoformat(),
                    'read': False
                })
    
    return jsonify({'success': result.modified_count > 0})

@app.route('/get-all-orders', methods=['GET'])
def get_all_orders():
    all_orders = list(orders_collection.find({}).sort('created_at', -1))
    for order in all_orders:
        order['_id'] = str(order['_id'])
        if 'created_at' in order:
            order['formatted_date'] = datetime.fromisoformat(order['created_at']).strftime('%Y-%m-%d %H:%M')
        if 'cancel_reason' in order and order['cancel_reason']:
            order['status_display'] = f"{order['status']} ({order['cancel_reason']})"
        else:
            order['status_display'] = order['status']
    return jsonify({'success': True, 'orders': all_orders})

@app.route('/generate-receipt', methods=['POST'])
def generate_receipt():
    data = request.json
    order_id = data.get('order_id')
    if not order_id:
        return jsonify({'success': False, 'message': 'Order ID required'})
    
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        return jsonify({'success': False, 'message': 'Order not found'})
    
    order['_id'] = str(order['_id'])
    order['formatted_date'] = datetime.fromisoformat(order['created_at']).strftime('%Y-%m-%d %H:%M')
    
    receipt_data = {
        'success': True,
        'order_id': order['order_id'],
        'date': order['formatted_date'],
        'customer': order.get('customer_gmail', 'Customer'),
        'items': order.get('items', []),
        'subtotal': order.get('subtotal', 0),
        'delivery_fee': order.get('delivery_fee', 0),
        'total': order.get('total', 0),
        'payment': order.get('payment', 'CASH').upper(),
        'address': order.get('address', ''),
        'time': order.get('time', '')
    }
    return jsonify(receipt_data)

@app.route('/pending-orders', methods=['GET'])
def get_pending_orders():
    pending = list(orders_collection.find({'status': 'pending'}).sort('created_at', -1))
    for order in pending:
        order['_id'] = str(order['_id'])
    return jsonify({'success': True, 'pending_orders': pending})

@app.route('/available-slots', methods=['GET'])
def available_slots():
    date = request.args.get('date', '')
    if not date:
        return jsonify({'success': False, 'message': 'Date required'})
    
    slots = []
    start_hour = 9
    for hour in range(start_hour, 20):
        slot_time = f"{hour:02d}:00"
        dt = datetime.strptime(f"{date} {slot_time}", "%Y-%m-%d %H:%M")
        
        busy_count = orders_collection.count_documents({
            'scheduled_date': date,
            'scheduled_time': slot_time,
            'status': {'$in': ['scheduled', 'pending']}
        })
        
        if busy_count < 3:
            slots.append({'time': slot_time, 'available': True})
        else:
            slots.append({'time': slot_time, 'available': False})
    
    return jsonify({'success': True, 'slots': slots})

@app.route('/dashboard-data', methods=['GET'])
def get_dashboard_data():
    period = request.args.get('period', 'monthly')
    date_filter = get_date_filter(period)
    
    # Get all approved return request order IDs to exclude from sales
    approved_returns = return_requests_collection.find({'status': 'approved'})
    approved_return_ids = [ret.get('order_id') for ret in approved_returns]
    
    # Calculate total orders and revenue (excluding approved returns)
    total_query = {'status': 'delivered', 'order_id': {'$nin': approved_return_ids}}
    total_orders = orders_collection.count_documents(total_query)
    
    total_revenue = sum(order.get('total', 0) for order in orders_collection.find(total_query))
    
    
    # Calculate period orders and revenue (excluding approved returns)
    period_query = {
        'created_at': {'$gte': date_filter.isoformat()}, 
        'status': 'delivered',
        'order_id': {'$nin': approved_return_ids}
    }
    orders_in_period = list(orders_collection.find(period_query))
    period_orders = len(orders_in_period)
    period_revenue = sum(order.get('total', 0) for order in orders_in_period)
    
    
    daily_sales = {}
    for order in orders_in_period:
        date = order.get('created_at', '')[:10]
        if date:
            daily_sales[date] = daily_sales.get(date, 0) + order.get('total', 0)
    
    
    day_names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    sales_by_day = {day: 0 for day in day_names}
    for order in orders_in_period:
        date_str = order.get('created_at', '')[:10]
        if date_str:
            try:
                dt = datetime.fromisoformat(date_str)
                day_name = day_names[dt.weekday()]
                sales_by_day[day_name] += 1
            except:
                pass
    
    
    month_names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    sales_by_month = {month: 0 for month in month_names}
    for order in orders_in_period:
        date_str = order.get('created_at', '')[:10]
        if date_str:
            try:
                dt = datetime.fromisoformat(date_str)
                month_name = month_names[dt.month - 1]
                sales_by_month[month_name] += 1
            except:
                pass
    
    
    product_sales = {}
    for order in orders_in_period:
        for item in order.get('items', []):
            name = item.get('name', 'Unknown')
            product_sales[name] = product_sales.get(name, 0) + 1
    
    
    orders = list(orders_collection.find().sort('created_at', -1).limit(50))
    for order in orders:
        order['_id'] = str(order['_id'])
    
    
    inventory = list(inventory_collection.find())
    for inv in inventory:
        inv['_id'] = str(inv['_id'])
    
    
    low_stock = [inv for inv in inventory if inv.get('stock', 0) < 10]
    
    pending_orders = list(orders_collection.find({'status': 'pending'}).sort('created_at', -1).limit(10))
    for order in pending_orders:
        order['_id'] = str(order['_id'])
    
    notifications = len(pending_orders)
    
    scheduled_count = len([o for o in orders_in_period if o.get('status') == 'scheduled'])
    pending_count = len([o for o in orders_in_period if o.get('status') == 'pending'])
    
    
    total_logins = login_history_collection.count_documents({})
    
    
    logins_in_period = list(login_history_collection.find({'login_time': {'$gte': date_filter.isoformat()}}))
    period_logins = len(logins_in_period)
    
    
    logins_by_day = {day: 0 for day in day_names}
    for login in logins_in_period:
        date_str = login.get('login_date', '')
        if date_str:
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                day_name = day_names[dt.weekday()]
                logins_by_day[day_name] += 1
            except:
                pass
    
    
    daily_logins = {}
    for login in logins_in_period:
        date = login.get('login_date', '')
        if date:
            daily_logins[date] = daily_logins.get(date, 0) + 1
    
    
    unique_customers = login_history_collection.distinct('gmail')
    total_unique_customers = len(unique_customers)
    
    
    recent_logins = list(login_history_collection.find().sort('login_time', -1).limit(10))
    for login in recent_logins:
        login['_id'] = str(login['_id'])
    
    total_variants = inventory_collection.count_documents({})
    available_variants_count = inventory_collection.count_documents({'available': True})
    unavailable_variants_count = inventory_collection.count_documents({'available': False})
    
    availability_stats = {
        'total_variants': total_variants,
        'available_variants': available_variants_count,
        'unavailable_variants': unavailable_variants_count,
        'availability_rate': f"{(available_variants_count / max(1, total_variants)) * 100:.1f}%"
    }
    
    return jsonify({
        'success': True,
        'total_orders': total_orders,
        'total_revenue': total_revenue,
        'period_orders': period_orders,
        'period_revenue': period_revenue,
        'daily_sales': daily_sales,
        'sales_by_day': sales_by_day,
        'sales_by_month': sales_by_month,
        'product_sales': product_sales,
        'orders': orders,
        'inventory': inventory,
        'low_stock': low_stock,
        'scheduled_count': scheduled_count,
        'pending_count': pending_count,
        'notifications': notifications,
        'pending_orders': pending_orders,
        'total_logins': total_logins,
        'period_logins': period_logins,
        'logins_by_day': logins_by_day,
        'daily_logins': daily_logins,
        'total_unique_customers': total_unique_customers,
        'recent_logins': recent_logins,
        'availability_stats': availability_stats
    })

@app.route('/sales-stats', methods=['GET'])
def get_sales_stats():
    period = request.args.get('period', 'monthly')
    date_filter = get_date_filter(period)
    
    # Get all approved return request order IDs to exclude from sales
    approved_returns = return_requests_collection.find({'status': 'approved'})
    approved_return_ids = [ret.get('order_id') for ret in approved_returns]
    
    # Fetch orders excluding approved returns
    orders_in_period = list(orders_collection.find({
        'created_at': {'$gte': date_filter.isoformat()}, 
        'status': 'delivered',
        'order_id': {'$nin': approved_return_ids}
    }))
    
    
    revenue_by_date = {}
    for order in orders_in_period:
        date = order.get('created_at', '')[:10]
        if date:
            revenue_by_date[date] = revenue_by_date.get(date, 0) + order.get('total', 0)
    
    
    sales_by_product = {}
    for order in orders_in_period:
        for item in order.get('items', []):
            name = item.get('name', 'Unknown')
            sales_by_product[name] = sales_by_product.get(name, 0) + 1
    
    
    top_selling = sorted(sales_by_product.items(), key=lambda x: x[1], reverse=True)[:5]
    
    return jsonify({
        'success': True,
        'period': period,
        'total_orders': len(orders_in_period),
        'total_revenue': sum(order.get('total', 0) for order in orders_in_period),
        'revenue_by_date': revenue_by_date,
        'sales_by_product': sales_by_product,
        'top_selling': top_selling
    })

@app.route('/update-price', methods=['POST'])
def update_price():
    data = request.json
    product_name = data.get('product_name')
    quantity = data.get('quantity')
    new_price = data.get('new_price')
    
    if not product_name or not quantity or not new_price:
        return jsonify({'success': False, 'message': 'Missing required fields'})
    
    try:
        result = products_collection.update_one(
            {'name': product_name},
            {f'$set': {f'prices.{quantity}': int(new_price)}}
        )
        
        if result.modified_count > 0:
            return jsonify({'success': True, 'message': 'Price updated successfully'})
        else:
            return jsonify({'success': False, 'message': 'Product not found'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/update-stock', methods=['POST'])
def update_stock():
    data = request.json
    product_name = data.get('product_name')
    new_stock = data.get('new_stock')
    variant = data.get('variant', 'DEFAULT')
    
    if not product_name or new_stock is None:
        return jsonify({'success': False, 'message': 'Missing required fields'})
    
    try:
        if variant and variant != 'DEFAULT':
            result = inventory_collection.update_one(
                {'product_name': product_name, 'variant': variant},
                {'$set': {'stock': int(new_stock), 'last_updated': datetime.now().isoformat()}}
            )
        else:
            result = inventory_collection.update_many(
                {'product_name': product_name},
                {'$set': {'stock': int(new_stock), 'last_updated': datetime.now().isoformat()}}
            )
        
        if result.modified_count > 0:
            return jsonify({'success': True, 'message': 'Stock updated successfully'})
        else:
            return jsonify({'success': False, 'message': 'Product not found'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/dashboard', methods=['GET'])
def get_dashboard():
    # Get all approved return request order IDs to exclude from sales
    approved_returns = return_requests_collection.find({'status': 'approved'})
    approved_return_ids = [ret.get('order_id') for ret in approved_returns]
    
    # Count only delivered orders that don't have approved returns
    total_orders = orders_collection.count_documents({
        'status': 'delivered',
        'order_id': {'$nin': approved_return_ids}
    })
    total_revenue = sum(order.get('total', 0) for order in orders_collection.find({
        'status': 'delivered',
        'order_id': {'$nin': approved_return_ids}
    }))
    orders = list(orders_collection.find().sort('created_at', -1).limit(50))
    
    for order in orders:
        order['_id'] = str(order['_id'])
    
    return jsonify({
        'success': True,
        'total_orders': total_orders,
        'total_revenue': total_revenue,
        'orders': orders
    })

@app.route('/sales-only', methods=['GET'])
def get_sales_only():
    # Get all approved return request order IDs to exclude from sales
    approved_returns = return_requests_collection.find({'status': 'approved'})
    approved_return_ids = [ret.get('order_id') for ret in approved_returns]
    
    sales = list(orders_collection.find({
        'status': 'delivered',
        'order_id': {'$nin': approved_return_ids}
    }).sort('created_at', -1))
    total_sales = sum(order.get('total', 0) for order in sales)
    for order in sales:
        order['_id'] = str(order['_id'])
    return jsonify({
        'success': True,
        'sales_orders': sales,
        'total_sales_revenue': total_sales
    })

@app.route('/request-owner-email-change', methods=['POST'])
def request_owner_email_change():
    """Request OTP to change owner email"""
    data = request.json
    current_gmail = data.get('current_gmail', '').strip().lower()
    new_gmail = data.get('new_gmail', '').strip().lower()
    password = data.get('password', '')
    
    if not current_gmail or not new_gmail or not password:
        return jsonify({'success': False, 'message': 'All fields are required'})
    
    if not new_gmail.endswith('@gmail.com'):
        return jsonify({'success': False, 'message': 'New Gmail must be a valid @gmail.com address'})
    
    if current_gmail == new_gmail:
        return jsonify({'success': False, 'message': 'New email must be different from current email'})
    
    # Verify owner exists and password is correct
    owner = users_collection.find_one({'gmail': current_gmail, 'role': 'owner'})
    
    if not owner:
        return jsonify({'success': False, 'message': 'Owner account not found'})
    
    if not check_password_hash(owner.get('password', ''), password):
        return jsonify({'success': False, 'message': 'Password is incorrect'})
    
    # Check if new email is already in use
    existing = users_collection.find_one({'gmail': new_gmail, 'role': 'owner'})
    if existing:
        return jsonify({'success': False, 'message': 'New Gmail is already in use'})
    
    # Generate and send OTP to new email
    otp = generate_otp()
    save_otp(new_gmail, otp, purpose='change_email')
    
    email_sent = send_otp_email(new_gmail, otp, purpose='change_email')
    
    if not email_sent:
        return jsonify({'success': False, 'message': 'Failed to send OTP to new email. Please try again.'})
    
    # Store pending email change request temporarily in user document
    users_collection.update_one(
        {'gmail': current_gmail, 'role': 'owner'},
        {'$set': {'pending_email_change': new_gmail, 'email_change_time': datetime.now().isoformat()}}
    )
    
    return jsonify({
        'success': True,
        'message': f'OTP sent to {new_gmail}. Please verify to complete email change.',
        'new_email': new_gmail
    })

@app.route('/verify-owner-email-change', methods=['POST'])
def verify_owner_email_change():
    """Verify OTP and complete owner email change"""
    data = request.json
    current_gmail = data.get('current_gmail', '').strip().lower()
    new_gmail = data.get('new_gmail', '').strip().lower()
    otp = data.get('otp', '').strip()
    new_password = data.get('new_password', '')
    
    if not current_gmail or not new_gmail or not otp:
        return jsonify({'success': False, 'message': 'All fields are required'})
    
    # Verify OTP
    is_valid, message = verify_otp(new_gmail, otp, purpose='change_email')
    
    if not is_valid:
        return jsonify({'success': False, 'message': message})
    
    # Get owner
    owner = users_collection.find_one({'gmail': current_gmail, 'role': 'owner'})
    
    if not owner:
        return jsonify({'success': False, 'message': 'Owner account not found'})
    
    # Verify pending email matches
    if owner.get('pending_email_change') != new_gmail:
        return jsonify({'success': False, 'message': 'Email change request mismatch'})
    
    # Prepare update data
    update_data = {
        'gmail': new_gmail,
        '$unset': {'pending_email_change': '', 'email_change_time': ''}
    }
    
    # Update password if provided
    if new_password:
        if len(new_password) < 6:
            return jsonify({'success': False, 'message': 'New password must be at least 6 characters'})
        update_data['password'] = generate_password_hash(new_password)
    
    # Update owner account
    users_collection.update_one(
        {'gmail': current_gmail, 'role': 'owner'},
        {'$set': {k: v for k, v in update_data.items() if k != '$unset'},
         '$unset': update_data.get('$unset', {})}
    )
    
    return jsonify({
        'success': True,
        'message': 'Email changed successfully!',
        'new_gmail': new_gmail
    })

@app.route('/update-owner-account', methods=['POST'])
def update_owner_account():
    """Update owner account - deprecated in favor of email change with OTP"""
    data = request.json
    current_gmail = data.get('current_gmail', '').strip().lower()
    new_gmail = data.get('new_gmail', '').strip().lower()
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    
    if not current_gmail or not current_password or not new_gmail or not new_password:
        return jsonify({'success': False, 'message': 'All fields are required'})
    
    if not new_gmail.endswith('@gmail.com'):
        return jsonify({'success': False, 'message': 'New Gmail must be a valid @gmail.com address'})
    
    if len(new_password) < 6:
        return jsonify({'success': False, 'message': 'New password must be at least 6 characters'})
    
    user = users_collection.find_one({'gmail': current_gmail, 'role': 'owner'})
    
    if not user:
        return jsonify({'success': False, 'message': 'Owner account not found'})
    
    if not check_password_hash(user.get('password', ''), current_password):
        return jsonify({'success': False, 'message': 'Current password is incorrect'})
    
    if new_gmail != current_gmail:
        existing = users_collection.find_one({'gmail': new_gmail, 'role': 'owner'})
        if existing:
            return jsonify({'success': False, 'message': 'Gmail already in use'})
    
    hashed_new_password = generate_password_hash(new_password)
    
    users_collection.update_one(
        {'gmail': current_gmail, 'role': 'owner'},
        {'$set': {'gmail': new_gmail, 'password': hashed_new_password}}
    )
    
    return jsonify({'success': True, 'message': 'Account updated successfully', 'new_gmail': new_gmail})

@app.route('/get-owner-account', methods=['POST'])
def get_owner_account():
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    
    user = users_collection.find_one({'gmail': gmail, 'role': 'owner'})
    
    if user:
        return jsonify({'success': True, 'gmail': user.get('gmail')})
    
    return jsonify({'success': False, 'message': 'Owner not found'})


@app.route('/get-owner-gmail', methods=['GET'])
def get_owner_gmail():
    """Get the current owner's Gmail address without requiring input"""
    try:
        owner = users_collection.find_one({'role': 'owner'})
        
        if owner:
            return jsonify({'success': True, 'gmail': owner.get('gmail')})
        
        return jsonify({'success': False, 'message': 'Owner not found'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error retrieving owner Gmail: {str(e)}'})


@app.route('/fix-inventory', methods=['POST'])
def fix_inventory():
    try:
        products = list(products_collection.find({}, {'_id': 0}))
        fixed_count = 0
        added_variants = []
        
        for product in products:
            product_name = product.get('name')
            variants = product.get('colors', []) or product.get('flavors', [])
            
            if not variants:
                variants = ['DEFAULT']
            
            for variant in variants:
                existing = inventory_collection.find_one({
                    'product_name': product_name,
                    'variant': variant
                })
                
                if not existing:
                    inventory_collection.insert_one({
                        'product_name': product_name,
                        'variant': variant,
                        'stock': 50,
                        'reserved': 0,
                        'sold': 0,
                        'available': True,
                        'last_updated': datetime.now().isoformat()
                    })
                    fixed_count += 1
                    added_variants.append(f"{product_name} - {variant}")
        
        return jsonify({
            'success': True,
            'message': f'Fixed {fixed_count} missing variants',
            'added': added_variants
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


@app.route('/toggle-variant-availability', methods=['POST'])
def toggle_variant_availability():
    data = request.json
    product_name = data.get('product_name')
    variant = data.get('variant')
    
    if not product_name or not variant:
        return jsonify({'success': False, 'message': 'Missing product_name or variant'})
    
    current_inv = inventory_collection.find_one({
        'product_name': product_name, 
        'variant': variant
    })
    
    if not current_inv:
        return jsonify({'success': False, 'message': 'Variant not found'})
    
    new_status = not current_inv.get('available', True)
    
    result = inventory_collection.update_one(
        {'product_name': product_name, 'variant': variant},
        {
            '$set': {
                'available': new_status,
                'last_updated': datetime.now().isoformat()
            }
        }
    )
    
    return jsonify({
        'success': True,
        'product_name': product_name,
        'variant': variant,
        'available': new_status,
        'status': 'AVAILABLE' if new_status else 'UNAVAILABLE',
        'button_text': 'Make Unavailable' if new_status else 'Make Available'
    })


@app.route('/add-product-variant', methods=['POST'])
def add_product_variant():
    data = request.json
    product_name = data.get('product_name')
    variant = data.get('variant')
    variant_type = data.get('variant_type', 'color') 
    
    if not product_name or not variant:
        return jsonify({'success': False, 'message': 'Missing product_name or variant'})
    
    if not variant.strip():
        return jsonify({'success': False, 'message': 'Variant cannot be empty'})
    
    
    product = products_collection.find_one({'name': product_name})
    if not product:
        return jsonify({'success': False, 'message': 'Product not found'})
    
    
    field = 'colors' if variant_type == 'color' else 'flavors'
    existing_variants = product.get(field, [])
    
    if variant.upper() in [v.upper() for v in existing_variants]:
        return jsonify({'success': False, 'message': f'{variant_type.capitalize()} already exists'})
    
    
    products_collection.update_one(
        {'name': product_name},
        {'$push': {field: variant.upper()}}
    )
    
    
    inventory_collection.insert_one({
        'product_name': product_name,
        'variant': variant.upper(),
        'stock': 50,
        'reserved': 0,
        'sold': 0,
        'available': True,
        'last_updated': datetime.now().isoformat()
    })
    
    return jsonify({
        'success': True,
        'message': f'{variant_type.capitalize()} added successfully',
        'variant': variant.upper()
    })


@app.route('/remove-product-variant', methods=['POST'])
def remove_product_variant():
    data = request.json
    product_name = data.get('product_name')
    variant = data.get('variant')
    variant_type = data.get('variant_type', 'color')
    
    if not product_name or not variant:
        return jsonify({'success': False, 'message': 'Missing product_name or variant'})
    
    
    product = products_collection.find_one({'name': product_name})
    if not product:
        return jsonify({'success': False, 'message': 'Product not found'})
    
    
    field = 'colors' if variant_type == 'color' else 'flavors'
    products_collection.update_one(
        {'name': product_name},
        {'$pull': {field: variant}}
    )
    
    
    inventory_collection.delete_one({
        'product_name': product_name,
        'variant': variant
    })
    
    return jsonify({
        'success': True,
        'message': f'{variant_type.capitalize()} removed successfully',
        'variant': variant
    })


@app.route('/add-new-product', methods=['POST'])
def add_new_product():
    data = request.json
    name = data.get('name', '').strip()
    category = data.get('category', '').strip()
    prices = data.get('prices', {})
    colors = data.get('colors', [])
    flavors = data.get('flavors', [])
    image = data.get('image', 'default.jpg')
    
    if not name or not category:
        return jsonify({'success': False, 'message': 'Name and category are required'})
    
    if not prices:
        return jsonify({'success': False, 'message': 'At least one price is required'})
    
    
    existing = products_collection.find_one({'name': name})
    if existing:
        return jsonify({'success': False, 'message': 'Product already exists'})
    
    
    new_product = {
        'name': name,
        'category': category.upper(),
        'prices': prices,
        'image': image
    }
    
    if colors:
        new_product['colors'] = [c.upper() for c in colors]
    if flavors:
        new_product['flavors'] = [f.upper() for f in flavors]
    
    products_collection.insert_one(new_product)
    
    
    variants = colors if colors else flavors if flavors else ['DEFAULT']
    for variant in variants:
        inventory_collection.insert_one({
            'product_id': str(products_collection.find_one({'name': name})['_id']),
            'product_name': name,
            'variant': variant.upper() if isinstance(variant, str) else variant,
            'stock': 50,
            'reserved': 0,
            'sold': 0,
            'available': True,
            'last_updated': datetime.now().isoformat()
        })

    
    new_product_copy = new_product.copy()
    if '_id' in new_product_copy:
        new_product_copy['_id'] = str(new_product_copy['_id'])
    
    return jsonify({
        'success': True,
        'message': 'Product added successfully',
        'product': new_product_copy
    })


@app.route('/delete-product', methods=['POST'])
def delete_product():
    data = request.json
    product_name = data.get('product_name')
    
    if not product_name:
        return jsonify({'success': False, 'message': 'Product name is required'})
    
    
    product = products_collection.find_one({'name': product_name})
    if not product:
        return jsonify({'success': False, 'message': 'Product not found'})
    
    
    
    image_filename = product.get('image')
    if image_filename and image_filename != 'default.jpg':
        image_path = os.path.join(UPLOAD_FOLDER, image_filename)
        if os.path.exists(image_path):
            try:
                os.remove(image_path)
                print(f"Deleted image: {image_filename}")
            except Exception as e:
                print(f"Error deleting image {image_filename}: {e}")
    
    
    products_collection.delete_one({'name': product_name})
    
    
    inventory_collection.delete_many({'product_name': product_name})
    
    return jsonify({
        'success': True,
        'message': 'Product deleted successfully'
    })


@app.route('/get-products-with-stock', methods=['GET'])
def get_products_with_stock():
    products = list(products_collection.find({}, {'_id': 0}))
    all_inventory = list(inventory_collection.find())
    
    available_variants = {}
    for inv in all_inventory:
        variant = inv.get('variant', 'DEFAULT')
        key = inv['product_name'] + '_' + variant
        if inv.get('available', True):
            available_variants[key] = inv
    
    all_variants = {}
    for inv in all_inventory:
        variant = inv.get('variant', 'DEFAULT')
        key = inv['product_name'] + '_' + variant
        all_variants[key] = inv
    
    customer_products = []
    owner_products = []
    
    for product in products:
        customer_product = product.copy()
        owner_product = product.copy()
        
        customer_product['variants'] = []
        owner_product['variants'] = []
        owner_product['unavailable_variants'] = []
        
        if 'colors' in product:
            for color in product['colors']:
                key = f"{product['name']}_{color}"
                
                inv = all_variants.get(key)
                owner_variant = {
                    'type': 'color',
                    'name': color,
                    'stock': inv['stock'] if inv else 0,
                    'reserved': inv.get('reserved', 0) if inv else 0,
                    'available': inv.get('available', True) if inv else True,
                    'status': 'AVAILABLE' if (inv and inv.get('available', True)) else 'UNAVAILABLE'
                }
                owner_product['variants'].append(owner_variant)
                
                if not owner_variant['available']:
                    owner_product['unavailable_variants'].append(color)
                
                
                if inv:
                    is_available = inv.get('available', True)
                    available_inv = available_variants.get(key) if is_available else None
                    customer_variant = {
                        'type': 'color',
                        'name': color,
                        'stock': available_inv['stock'] if available_inv else 0,
                        'available': is_available
                    }
                    customer_product['variants'].append(customer_variant)
                else:
                    
                    customer_variant = {
                        'type': 'color',
                        'name': color,
                        'stock': 0,
                        'available': True
                    }
                    customer_product['variants'].append(customer_variant)
        
        elif 'flavors' in product:
            for flavor in product['flavors']:
                key = f"{product['name']}_{flavor}"
                
                inv = all_variants.get(key)
                owner_variant = {
                    'type': 'flavor',
                    'name': flavor,
                    'stock': inv['stock'] if inv else 0,
                    'reserved': inv.get('reserved', 0) if inv else 0,
                    'available': inv.get('available', True) if inv else True,
                    'status': 'AVAILABLE' if (inv and inv.get('available', True)) else 'UNAVAILABLE'
                }
                owner_product['variants'].append(owner_variant)
                
                if not owner_variant['available']:
                    owner_product['unavailable_variants'].append(flavor)
                
                
                if inv:
                    is_available = inv.get('available', True)
                    available_inv = available_variants.get(key) if is_available else None
                    customer_variant = {
                        'type': 'flavor',
                        'name': flavor,
                        'stock': available_inv['stock'] if available_inv else 0,
                        'available': is_available
                    }
                    customer_product['variants'].append(customer_variant)
                else:
                    
                    customer_variant = {
                        'type': 'flavor',
                        'name': flavor,
                        'stock': 0,
                        'available': True
                    }
                    customer_product['variants'].append(customer_variant)
        
        customer_products.append(customer_product)
        owner_products.append(owner_product)
    
    owner_mode = request.args.get('owner') == '1'
    return jsonify({
        'success': True,
        'products': owner_products if owner_mode else customer_products,
        'owner_mode': owner_mode,
        'total_unavailable': sum(len(p.get('unavailable_variants', [])) for p in owner_products)
    })


@app.route('/save-cart', methods=['POST'])
def save_cart():
    data = request.json
    gmail = data.get('gmail')
    cart = data.get('cart', [])
    removed_products = data.get('removed_products', [])
    
    users_collection.update_one(
        {'gmail': gmail},
        {'$set': {'cart': cart, 'removed_products': removed_products}},
        upsert=True
    )
    
    for item in cart:
        product_name = item.get('name')
        variant = item.get('variant', 'DEFAULT')
        quantity = int(item.get('quantity', 1))
        
        inv = inventory_collection.find_one({
            'product_name': product_name, 
            'variant': variant
        })
        
        if not inv or not inv.get('available', True):
            return jsonify({'success': False, 'message': f'{variant} is currently unavailable'})
    
    for item in cart:
        product_name = item.get('name')
        variant = item.get('variant', 'DEFAULT')
        quantity = int(item.get('quantity', 1))
        
        inventory_collection.update_one(
            {'product_name': product_name, 'variant': variant},
            {'$inc': {'reserved': quantity}}
        )
    
    return jsonify({'success': True})



@app.route('/get-categories', methods=['GET'])
def get_categories():
    categories = list(categories_collection.find({}, {'_id': 0}))
    return jsonify({'success': True, 'categories': categories})

@app.route('/add-category', methods=['POST'])
def add_category():
    data = request.json
    category_name = data.get('name', '').strip()
    
    if not category_name:
        return jsonify({'success': False, 'message': 'Category name is required'})
    
    
    existing = categories_collection.find_one({'name': category_name.upper()})
    if existing:
        return jsonify({'success': False, 'message': 'Category already exists'})
    
    categories_collection.insert_one({
        'name': category_name.upper(),
        'created_at': datetime.now().isoformat()
    })
    
    return jsonify({
        'success': True,
        'message': 'Category added successfully',
        'category': category_name.upper()
    })

@app.route('/delete-category', methods=['POST'])
def delete_category():
    data = request.json
    category_name = data.get('name', '').strip()
    
    if not category_name:
        return jsonify({'success': False, 'message': 'Category name is required'})
    
    
    product_count = products_collection.count_documents({'category': category_name.upper()})
    if product_count > 0:
        return jsonify({
            'success': False, 
            'message': f'Cannot delete category. It has {product_count} product(s). Delete or move products first.'
        })
    
    result = categories_collection.delete_one({'name': category_name.upper()})
    
    if result.deleted_count > 0:
        return jsonify({'success': True, 'message': 'Category deleted successfully'})
    else:
        return jsonify({'success': False, 'message': 'Category not found'})


@app.route('/upload-product-image', methods=['POST'])
def upload_product_image():
    """Handle product image upload"""
    if 'image' not in request.files:
        return jsonify({'success': False, 'message': 'No image file provided'})
    
    file = request.files['image']
    
    if file.filename == '':
        return jsonify({'success': False, 'message': 'No image file selected'})
    
    if file and allowed_file(file.filename):
       
        ext = file.filename.rsplit('.', 1)[1].lower()
        
        
        unique_filename = f"{uuid.uuid4().hex}.{ext}"
        
        
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
        
        
        file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
        file.save(file_path)
        
        return jsonify({
            'success': True,
            'message': 'Image uploaded successfully',
            'filename': unique_filename
        })
    else:
        return jsonify({'success': False, 'message': 'Invalid file type. Allowed: jpg, jpeg, png, gif, webp'})


@app.route('/add-new-product-with-image', methods=['POST'])
def add_new_product_with_image():
    """Add new product with image upload"""
    try:
        
        image_filename = 'default.jpg'
        
        if 'image' in request.files:
            file = request.files['image']
            if file.filename != '' and allowed_file(file.filename):
                ext = file.filename.rsplit('.', 1)[1].lower()
                unique_filename = f"{uuid.uuid4().hex}.{ext}"
                os.makedirs(UPLOAD_FOLDER, exist_ok=True)
                file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
                file.save(file_path)
                image_filename = unique_filename
        
        
        name = request.form.get('name', '').strip()
        category = request.form.get('category', '').strip()
        prices_json = request.form.get('prices', '{}')
        colors_json = request.form.get('colors', '[]')
        flavors_json = request.form.get('flavors', '[]')
        
        import json
        try:
            prices = json.loads(prices_json)
            colors = json.loads(colors_json)
            flavors = json.loads(flavors_json)
        except:
            return jsonify({'success': False, 'message': 'Invalid data format'})
        
        if not name or not category:
            return jsonify({'success': False, 'message': 'Name and category are required'})
        
        if not prices:
            return jsonify({'success': False, 'message': 'At least one price is required'})
        
        existing = products_collection.find_one({'name': name})
        if existing:
            return jsonify({'success': False, 'message': 'Product already exists'})
        
        new_product = {
            'name': name,
            'category': category.upper(),
            'prices': prices,
            'image': image_filename
        }
        
        if colors:
            new_product['colors'] = [c.upper() for c in colors]
        if flavors:
            new_product['flavors'] = [f.upper() for f in flavors]
        
        products_collection.insert_one(new_product)
        
        hash_success = update_product_hash(name, image_filename)
        
        variants = colors if colors else flavors if flavors else ['DEFAULT']
        for variant in variants:
            inventory_collection.insert_one({
                'product_id': str(products_collection.find_one({'name': name})['_id']),
                'product_name': name,
                'variant': variant.upper() if isinstance(variant, str) else variant,
                'stock': 50,
                'reserved': 0,
                'sold': 0,
                'available': True,
                'last_updated': datetime.now().isoformat()
            })
        
        new_product_copy = new_product.copy()
        if '_id' in new_product_copy:
            new_product_copy['_id'] = str(new_product_copy['_id'])
        
        message = 'Product added successfully'
        if hash_success:
            message += ' (Image hash computed for identification)'
        else:
            message += ' (Warning: Could not compute image hash)'
        
        return jsonify({
            'success': True,
            'message': message,
            'product': new_product_copy,
            'hash_computed': hash_success
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/chat', methods=['POST'])
def chat():
    """Handle chat messages with smart product recommendations"""
    try:
        data = request.json
        message = data.get('message', '').strip()
        customer_email = data.get('customer_email', 'guest')
        lower_msg = message.lower()
        
        # Use customer email as session identifier
        session_id = customer_email
        
        import re
        
        # Store user message in database
        messages_collection.insert_one({
            'customer_email': customer_email,
            'type': 'user',
            'message': message,
            'timestamp': datetime.now().isoformat()
        })
        
        # Check if user is asking to see more variants from previous recommendation
        if lower_msg in ['more', 'show more', 'see more'] or (lower_msg.isdigit() and int(lower_msg) > 5):
            if session_id in chat_sessions and chat_sessions[session_id].get('last_recommendation'):
                bot_response = show_more_variants(session_id)
                # Store bot response
                resp_data = bot_response.get_json()
                messages_collection.insert_one({
                    'customer_email': customer_email,
                    'type': 'bot',
                    'message': resp_data['response'],
                    'timestamp': datetime.now().isoformat()
                })
                return bot_response
        
        budget_match = re.search(r'(\d+)\s*(pesos|budget|afford)', lower_msg)
        if budget_match:
            budget = int(budget_match.group(1))
            bot_response = get_budget_recommendation(budget, session_id)
            # Store bot response
            resp_data = bot_response.get_json()
            messages_collection.insert_one({
                'customer_email': customer_email,
                'type': 'bot',
                'message': resp_data['response'],
                'timestamp': datetime.now().isoformat()
            })
            return bot_response
        
        if any(word in lower_msg for word in ['product', 'flower', 'donut', 'bouquet', 'ribbon']):
            bot_response = get_products_info()
            resp_data = bot_response.get_json()
            messages_collection.insert_one({
                'customer_email': customer_email,
                'type': 'bot',
                'message': resp_data['response'],
                'timestamp': datetime.now().isoformat()
            })
            return bot_response
        
        if any(word in lower_msg for word in ['price', 'cost', 'how much', 'expensive']):
            bot_response = get_price_info()
            resp_data = bot_response.get_json()
            messages_collection.insert_one({
                'customer_email': customer_email,
                'type': 'bot',
                'message': resp_data['response'],
                'timestamp': datetime.now().isoformat()
            })
            return bot_response
        
        if any(word in lower_msg for word in ['color', 'flavor', 'variant', 'available']):
            bot_response = get_variants_info()
            resp_data = bot_response.get_json()
            messages_collection.insert_one({
                'customer_email': customer_email,
                'type': 'bot',
                'message': resp_data['response'],
                'timestamp': datetime.now().isoformat()
            })
            return bot_response
        
        if any(word in lower_msg for word in ['hello', 'hi', 'hey', 'help']):
            response = "Hi! I'm Juana's AI Assistant! I can help you with:\n- Browse our gorgeous products\n- Find items in your budget\n- Show available colors & flavors\n- Give you pricing info\n\nWhat would you like to know?"
            messages_collection.insert_one({
                'customer_email': customer_email,
                'type': 'bot',
                'message': response,
                'timestamp': datetime.now().isoformat()
            })
            return jsonify({'response': response})
        
        if any(word in lower_msg for word in ['about', 'who']):
            response = "I'm Juana's Ribbon! We create beautiful handmade:\n- Ribbon Flowers (Roses, Sunflowers, Tulips)\n- Gorgeous Bouquets (Lover Inspired, Fuzzy Wire, Butterfly)\n- Delicious Mini Donuts\n\nAll made with love!"
            messages_collection.insert_one({
                'customer_email': customer_email,
                'type': 'bot',
                'message': response,
                'timestamp': datetime.now().isoformat()
            })
            return jsonify({'response': response})
        
        if any(word in lower_msg for word in ['order', 'buy', 'checkout']):
            response = "Easy! Here's how to order:\n1. Browse our products\n2. Pick your colors/flavors & quantity\n3. Add to cart\n4. Login with Gmail\n5. Checkout!\n\nWant a specific recommendation?"
            messages_collection.insert_one({
                'customer_email': customer_email,
                'type': 'bot',
                'message': response,
                'timestamp': datetime.now().isoformat()
            })
            return jsonify({'response': response})
        
        response = "I didn't quite catch that! Try asking me about:\n- What can I get for 300 pesos?\n- Show me ribbon flowers\n- Donut flavors\n- Available colors\n- Prices"
        messages_collection.insert_one({
            'customer_email': customer_email,
            'type': 'bot',
            'message': response,
            'timestamp': datetime.now().isoformat()
        })
        return jsonify({'response': response})
    
    except Exception as e:
        return jsonify({'response': f'Oops! There was an error: {str(e)}. Please try again!'})

@app.route('/get-chat-history', methods=['POST'])
def get_chat_history():
    """Get chat history for a customer"""
    try:
        data = request.json
        customer_email = data.get('customer_email', 'guest')
        
        # Get last 50 messages
        messages = list(messages_collection.find({
            'customer_email': customer_email
        }).sort('timestamp', -1).limit(50))
        
        # Reverse to show oldest first
        messages.reverse()
        
        return jsonify({
            'success': True,
            'messages': [
                {
                    'type': msg.get('type'),
                    'message': msg.get('message'),
                    'timestamp': msg.get('timestamp')
                } for msg in messages
            ]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def show_more_variants(session_id):
    """Show remaining products from previous recommendation"""
    try:
        session_data = chat_sessions.get(session_id, {})
        last_rec = session_data.get('last_recommendation', {})
        all_recommendations = last_rec.get('all_recommendations', [])
        top_products_count = 5
        
        if not all_recommendations or len(all_recommendations) <= top_products_count:
            return jsonify({'response': "There are no more products to show!"})
        
        remaining = all_recommendations[top_products_count:]
        response = f"📋 HERE ARE {len(remaining)} MORE PRODUCTS:\n"
        response += "=" * 50 + "\n\n"
        
        for idx, product in enumerate(remaining, 6):
            response += f"📦 OPTION {idx}: {product['name']}\n"
            response += f"   └─ Quantity: {product['quantity']} pcs\n"
            response += f"   └─ Price: ₱{product['price']}\n"
            response += f"   └─ Category: {product['category']}\n"
            
            if product['variants']:
                variant_sample = ', '.join(product['variants'][:3])
                response += f"   └─ Colors/Flavors: {variant_sample}"
                if len(product['variants']) > 3:
                    response += f" + {len(product['variants']) - 3} more"
                response += "\n"
            response += "\n"
        
        response += "=" * 50
        return jsonify({'response': response})
    except Exception as e:
        return jsonify({'response': f"Error loading more products: {str(e)}"})

def get_budget_recommendation(budget, session_id):
    """Recommend products based on budget"""
    try:
        products = list(products_collection.find())
        recommendations = []
        
        for product in products:
            prices = product.get('prices', {})
            for quantity, price in prices.items():
                if price <= budget and price > 0:
                    recommendations.append({
                        'name': product['name'],
                        'quantity': quantity,
                        'price': price,
                        'category': product.get('category', ''),
                        'variants': product.get('colors', product.get('flavors', []))
                    })
        
        recommendations.sort(key=lambda x: abs(budget - x['price']))
        
        if not recommendations:
            return jsonify({'response': f"Hmm, with {budget} pesos, we're a bit short...\nOur mini donuts start from 60 pesos!\nWould you like to see all products?"})
        
        # Show top 5 products within budget
        top_products = recommendations[:5]
        response = f"✨ Great! Here are {len(top_products)} items I found for {budget} pesos:\n"
        response += "=" * 50 + "\n\n"
        
        for idx, product in enumerate(top_products, 1):
            response += f"📦 OPTION {idx}: {product['name']}\n"
            response += f"   └─ Quantity: {product['quantity']} pcs\n"
            response += f"   └─ Price: ₱{product['price']}\n"
            response += f"   └─ Category: {product['category']}\n"
            
            if product['variants']:
                variant_sample = ', '.join(product['variants'][:3])
                response += f"   └─ Colors/Flavors: {variant_sample}"
                if len(product['variants']) > 3:
                    response += f" + {len(product['variants']) - 3} more"
                response += "\n"
            response += "\n"
        
        # Store all recommendations for later "more" requests
        if session_id not in chat_sessions:
            chat_sessions[session_id] = {}
        chat_sessions[session_id]['last_recommendation'] = {
            'products': top_products,
            'all_recommendations': recommendations,
            'budget': budget
        }
        
        response += "=" * 50
        if len(recommendations) > 5:
            response += f"\n\n💡 Type 'more' to see {len(recommendations) - 5} more options!"
        
        return jsonify({'response': response})
    except Exception as e:
        return jsonify({'response': f"Error getting recommendations: {str(e)}"})

def get_products_info():
    """Get all products information"""
    try:
        products = list(products_collection.find())
        if not products:
            return jsonify({'response': "No products found!"})
        
        categories = {}
        for product in products:
            cat = product.get('category', 'OTHER')
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(product)
        
        response = "OUR BEAUTIFUL COLLECTION:\n\n"
        for category, items in categories.items():
            response += f"{category} ({len(items)} items)\n"
            for item in items:
                min_price = min(item.get('prices', {1: 0}).values()) if item.get('prices') else 0
                response += f"  - {item['name']} | from {min_price} pesos\n"
            response += "\n"
        
        response += "TIP: Type a budget like '300 pesos' for personalized recommendations!"
        return jsonify({'response': response})
    except Exception as e:
        return jsonify({'response': f"Error loading products: {str(e)}"})

def get_price_info():
    """Get pricing information"""
    try:
        products = list(products_collection.find())
        response = "OUR PRICING:\n\n"
        
        for product in products:
            prices = product.get('prices', {})
            if prices:
                price_list = ', '.join([f"{qty} qty: {price}P" for qty, price in sorted(prices.items(), key=lambda x: int(x[0]))])
                response += f"- {product['name']}: {price_list}\n"
        
        response += "\nTIP: Upload a photo to identify products!"
        return jsonify({'response': response})
    except Exception as e:
        return jsonify({'response': f"Error loading prices: {str(e)}"})

def get_variants_info():
    """Get variants (colors/flavors) information"""
    try:
        products = list(products_collection.find())
        response = "AVAILABLE COLORS & FLAVORS:\n\n"
        
        for product in products:
            colors = product.get('colors', [])
            flavors = product.get('flavors', [])
            variants = colors if colors else flavors
            
            if variants:
                variant_text = ', '.join(variants[:6])
                if len(variants) > 6:
                    variant_text += f" + {len(variants) - 6} more"
                response += f"{product['name']}: {variant_text}\n"
        
        return jsonify({'response': response})
    except Exception as e:
        return jsonify({'response': f"Error loading variants: {str(e)}"})

@app.route('/image-identify', methods=['POST'])
def image_identify():
    """Identify product from image"""
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'detected': 'No image provided'})
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'success': False, 'detected': 'No image selected'})
        
        if not allowed_file(file.filename):
            return jsonify({'success': False, 'detected': 'Invalid file type. Please use PNG, JPG, JPEG, GIF, or WEBP'})
        
        if not PRODUCT_HASHES:
            print("WARNING: PRODUCT_HASHES is empty, reinitializing...")
            seed_data()
            if not PRODUCT_HASHES:
                return jsonify({'success': False, 'detected': 'Product database not ready. Please try again later.'})
        
        ext = file.filename.rsplit('.', 1)[1].lower()
        temp_fd, temp_path = tempfile.mkstemp(suffix=f'.{ext}')
        file.save(temp_path)
        
        try:
            with Image.open(temp_path) as img:
                if img.mode not in ('RGB', 'L'):
                    img = img.convert('RGB')
                uploaded_hash = imagehash.average_hash(img)
            
            min_dist = float('inf')
            best_match = None
            best_distance = None
            max_hash_dist = 64  
            all_distances = []
            
            for image_filename, info in PRODUCT_HASHES.items():
                try:
                    product_hash = imagehash.hex_to_hash(info['hash'])
                    dist = uploaded_hash - product_hash
                    all_distances.append((image_filename, info['name'], dist))
                    
                    if dist < min_dist:
                        min_dist = dist
                        best_match = info['name']
                        best_distance = dist
                except Exception as hash_error:
                    print(f"Error comparing with {image_filename}: {str(hash_error)}")
                    continue
            
            print(f"\nImage identification attempt:")
            for fname, pname, dist in sorted(all_distances, key=lambda x: x[2]):
                print(f"  {pname}: distance={dist}")
            
            os.close(temp_fd)
            os.unlink(temp_path)
            
            close_match_threshold = 28       
            uncertain_threshold = 38          
            unknown_threshold = 50            
            
            if best_match and min_dist <= close_match_threshold:
                confidence = max(0, 1 - (min_dist / 64))
                print(f"Match found: {best_match} (distance={min_dist}, confidence={confidence:.1%})")
                return jsonify({
                    'success': True, 
                    'detected': best_match,
                    'confidence': f"{confidence:.1%}",
                    'distance': int(min_dist)
                })
            elif best_match and min_dist <= uncertain_threshold:
                confidence = max(0, 1 - (min_dist / 64))
                print(f"Uncertain match: {best_match} (distance={min_dist}, confidence={confidence:.1%})")
                return jsonify({
                    'success': False, 
                    'detected': 'Match unclear',
                    'closest': best_match,
                    'distance': int(min_dist),
                    'message': f'Likely: {best_match}. Try a photo with better lighting or different angle!'
                })
            elif best_match and min_dist <= unknown_threshold:
                print(f"Very weak match: {best_match} (distance={min_dist})")
                return jsonify({
                    'success': False, 
                    'detected': 'Not a recognized product',
                    'closest': best_match,
                    'distance': int(min_dist),
                    'message': 'This product may not be in our catalog. Try uploading a photo of one of our flowers or donuts!'
                })
            else:
                closest_name = best_match if best_match else 'Unknown'
                print(f"Unknown product attempt. Closest: {closest_name} (distance={int(min_dist)})")
                return jsonify({
                    'success': False, 
                    'detected': 'Not found in catalog',
                    'closest': closest_name,
                    'distance': int(min_dist) if min_dist != float('inf') else 99,
                    'message': 'This does not appear to be one of our products. Please upload a photo of: Ribbon Roses, Ribbon Sunflowers, Ribbon Tulips, Lover Bouquets, Fuzzy Lilies, Fuzzy Tulips, Butterfly Bouquets, or Mini Donuts!'
                })
        finally:
            if os.path.exists(temp_path):
                try:
                    os.close(temp_fd)
                except:
                    pass
                try:
                    os.unlink(temp_path)
                except:
                    pass
    
    except Exception as e:
        print(f"Error in image_identify: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'detected': 'Error analyzing image. Try again!', 'error': str(e)})

@app.route('/refresh-product-hashes', methods=['POST'])
def refresh_product_hashes():
    """Manually refresh all product image hashes (admin only)"""
    try:
        
        seed_data()  
        
        return jsonify({
            'success': True,
            'message': f'Product hashes refreshed. Total products: {len(PRODUCT_HASHES)}'
        })
    except Exception as e:
        print(f"Error refreshing hashes: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Error refreshing hashes: {str(e)}'
        })

@app.route('/check-product-hashes', methods=['GET'])
def check_product_hashes():
    """Check which products are currently loaded for image identification (for debugging)"""
    try:
        products_list = []
        for filename, info in PRODUCT_HASHES.items():
            products_list.append({
                'filename': filename,
                'name': info['name'],
                'hash': info['hash'][:32] + '...' 
            })
        
        return jsonify({
            'success': True,
            'total_products': len(PRODUCT_HASHES),
            'products': products_list
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error checking hashes: {str(e)}'
        })

# ===== MESSAGING ENDPOINTS =====

@app.route('/send-message', methods=['POST'])
def send_message():
    data = request.json
    sender = data.get('sender')
    recipient = data.get('recipient')
    message = data.get('message')
    
    if not sender or not recipient or not message:
        return jsonify({'success': False, 'message': 'Missing required fields'})
    
    try:
        message_doc = {
            'sender': sender,
            'recipient': recipient,
            'message': message,
            'timestamp': datetime.now().isoformat(),
            'read': False
        }
        
        result = messages_collection.insert_one(message_doc)
        
        return jsonify({
            'success': True,
            'message_id': str(result.inserted_id),
            'message': 'Message sent successfully'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error sending message: {str(e)}'
        })

@app.route('/get-messages', methods=['POST'])
def get_messages():
    data = request.json
    user1 = data.get('user1')
    user2 = data.get('user2')
    
    if not user1 or not user2:
        return jsonify({'success': False, 'message': 'Missing required fields'})
    
    try:
        # Get all messages between two users (in both directions)
        messages = list(messages_collection.find({
            '$or': [
                {'sender': user1, 'recipient': user2},
                {'sender': user2, 'recipient': user1}
            ]
        }).sort('timestamp', 1))
        
        # Convert ObjectId to string
        for msg in messages:
            msg['_id'] = str(msg['_id'])
        
        return jsonify({
            'success': True,
            'messages': messages
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error fetching messages: {str(e)}'
        })

@app.route('/get-conversations', methods=['POST'])
def get_conversations():
    data = request.json
    user_gmail = data.get('gmail')
    
    if not user_gmail:
        return jsonify({'success': False, 'message': 'Gmail required'})
    
    try:
        # Get all unique users this person has messaged with
        sent_messages = messages_collection.find({'sender': user_gmail})
        received_messages = messages_collection.find({'recipient': user_gmail})
        
        conversation_users = set()
        latest_messages = {}
        
        for msg in sent_messages:
            recipient = msg['recipient']
            conversation_users.add(recipient)
            key = f"{user_gmail}-{recipient}"
            if key not in latest_messages or msg['timestamp'] > latest_messages[key]['timestamp']:
                latest_messages[key] = msg
        
        for msg in received_messages:
            sender = msg['sender']
            conversation_users.add(sender)
            key = f"{sender}-{user_gmail}"
            if key not in latest_messages or msg['timestamp'] > latest_messages[key]['timestamp']:
                latest_messages[key] = msg
        
        # Build conversation list with latest message
        conversations = []
        for other_user in conversation_users:
            # Get latest message between these two users
            key1 = f"{user_gmail}-{other_user}"
            key2 = f"{other_user}-{user_gmail}"
            latest_msg = latest_messages.get(key1) or latest_messages.get(key2)
            
            if latest_msg:
                latest_msg['_id'] = str(latest_msg['_id'])
                conversations.append({
                    'other_user': other_user,
                    'latest_message': latest_msg['message'],
                    'latest_timestamp': latest_msg['timestamp'],
                    'is_sent': latest_msg['sender'] == user_gmail
                })
        
        # Sort by latest timestamp
        conversations.sort(key=lambda x: x['latest_timestamp'], reverse=True)
        
        return jsonify({
            'success': True,
            'conversations': conversations
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error fetching conversations: {str(e)}'
        })

@app.route('/mark-messages-read', methods=['POST'])
def mark_messages_read():
    data = request.json
    user1 = data.get('user1')
    user2 = data.get('user2')
    
    if not user1 or not user2:
        return jsonify({'success': False, 'message': 'Missing required fields'})
    
    try:
        # Mark messages from user2 to user1 as read
        result = messages_collection.update_many(
            {'sender': user2, 'recipient': user1},
            {'$set': {'read': True}}
        )
        
        return jsonify({
            'success': True,
            'message': 'Messages marked as read'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error marking messages: {str(e)}'
        })

@app.route('/check-user', methods=['POST'])
def check_user():
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    
    if not gmail:
        return jsonify({'success': False, 'message': 'Gmail required'})
    
    try:
        user = users_collection.find_one({'gmail': gmail})
        return jsonify({
            'success': True,
            'exists': user is not None,
            'gmail': gmail
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error checking user: {str(e)}'
        })

@app.route('/get-notifications', methods=['POST'])
def get_notifications():
    """Get notifications for customer or owner"""
    data = request.json
    gmail = data.get('gmail', '').strip().lower()
    role = data.get('role', '')
    
    if not gmail or not role:
        return jsonify({'success': False, 'message': 'Gmail and role required'})
    
    try:
        notifications = []
        
        if role == 'customer':
            # Get specific order ready notifications
            order_ready_notifs = list(notifications_collection.find(
                {'recipient': gmail, 'type': 'order_ready'}
            ).sort('created_at', -1).limit(3))
            
            for notif in order_ready_notifs:
                notifications.append({
                    'type': 'order_ready',
                    'order_id': notif.get('order_id'),
                    'message': notif.get('message'),
                    'date': notif.get('created_at', '')[:10],
                    'icon': 'fa-box-open',
                    'read': notif.get('read', False)
                })
            
            # Get return approved/disapproved notifications
            return_notifs = list(notifications_collection.find(
                {'recipient': gmail, 'type': {'$in': ['return_approved', 'return_disapproved']}}
            ).sort('created_at', -1).limit(5))
            
            for notif in return_notifs:
                icon = 'fa-check-circle' if notif.get('type') == 'return_approved' else 'fa-times-circle'
                notifications.append({
                    'type': notif.get('type'),
                    'order_id': notif.get('order_id'),
                    'message': notif.get('message'),
                    'date': notif.get('created_at', '')[:10],
                    'icon': icon,
                    'read': notif.get('read', False)
                })
            
            # Get customer's orders and their status
            customer_orders = list(orders_collection.find(
                {'customer_gmail': gmail}
            ).sort('created_at', -1).limit(5))
            
            for order in customer_orders:
                notifications.append({
                    'type': 'order_status',
                    'order_id': order.get('order_id'),
                    'status': order.get('status'),
                    'message': f"Order {order.get('order_id')} - {order.get('status').upper()}",
                    'date': order.get('created_at', '')[:10],
                    'total': order.get('total', 0),
                    'icon': 'fa-box'
                })
            
            # Get unread messages
            unread_messages = list(messages_collection.find(
                {'recipient': gmail, 'read': False}
            ).limit(3))
            
            for msg in unread_messages:
                notifications.append({
                    'type': 'message',
                    'sender': msg.get('sender'),
                    'message': msg.get('message', 'New message'),
                    'date': msg.get('timestamp', '')[:10],
                    'icon': 'fa-envelope'
                })
        
        elif role == 'owner':
            print(f"[DEBUG] Fetching owner notifications for: {gmail}")
            # Get return request notifications
            return_request_notifs = list(notifications_collection.find(
                {'recipient': gmail, 'type': 'return_request'}
            ).sort('created_at', -1).limit(5))
            
            print(f"[DEBUG] Found {len(return_request_notifs)} return request notifications")
            
            for notif in return_request_notifs:
                notifications.append({
                    'type': 'return_request',
                    'order_id': notif.get('order_id'),
                    'customer': notif.get('customer'),
                    'message': notif.get('message'),
                    'date': notif.get('created_at', '')[:10],
                    'icon': 'fa-redo',
                    'read': notif.get('read', False)
                })
            
            # Get order received notifications (customer confirmed delivery)
            order_received_notifs = list(notifications_collection.find(
                {'recipient': gmail, 'type': 'order_received'}
            ).sort('created_at', -1).limit(3))
            
            for notif in order_received_notifs:
                notifications.append({
                    'type': 'order_received',
                    'order_id': notif.get('order_id'),
                    'customer': notif.get('customer'),
                    'message': notif.get('message'),
                    'date': notif.get('created_at', '')[:10],
                    'icon': 'fa-check-circle',
                    'read': notif.get('read', False)
                })
            
            # Get pending orders for owner
            pending_orders = list(orders_collection.find(
                {'status': {'$in': ['pending', 'payment_pending', 'scheduled']}}
            ).sort('created_at', -1).limit(5))
            
            for order in pending_orders:
                notifications.append({
                    'type': 'pending_order',
                    'order_id': order.get('order_id'),
                    'customer': order.get('customer_gmail'),
                    'status': order.get('status'),
                    'message': f"Order {order.get('order_id')} from {order.get('customer_gmail')} - {order.get('status').upper()}",
                    'date': order.get('created_at', '')[:10],
                    'total': order.get('total', 0),
                    'items_count': len(order.get('items', [])),
                    'icon': 'fa-shopping-bag'
                })
            
            # Get unread messages
            unread_messages = list(messages_collection.find(
                {'recipient': gmail, 'read': False}
            ).limit(3))
            
            for msg in unread_messages:
                notifications.append({
                    'type': 'message',
                    'sender': msg.get('sender'),
                    'message': msg.get('message', 'New message'),
                    'date': msg.get('timestamp', '')[:10],
                    'icon': 'fa-envelope'
                })
            
            # Get low stock alerts
            low_stock = list(inventory_collection.find(
                {'stock': {'$lt': 10}, 'available': True}
            ).limit(3))
            
            for item in low_stock:
                notifications.append({
                    'type': 'low_stock',
                    'product': item.get('product_name'),
                    'variant': item.get('variant'),
                    'stock': item.get('stock'),
                    'message': f"Low stock: {item.get('product_name')} ({item.get('variant')}) - Only {item.get('stock')} left",
                    'icon': 'fa-warning'
                })
            
            # Get latest customer logins
            recent_logins = list(login_history_collection.find().sort('login_time', -1).limit(3))
            
            for login in recent_logins:
                login_date = login.get('login_date', '')
                login_time = login.get('login_time', '')[:19]  # Extract time portion
                notifications.append({
                    'type': 'customer_login',
                    'gmail': login.get('gmail'),
                    'date': login_date,
                    'time': login_time,
                    'message': f"Customer {login.get('gmail')} logged in",
                    'icon': 'fa-user-check'
                })
        
        return jsonify({
            'success': True,
            'notifications': notifications,
            'count': len(notifications)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error retrieving notifications: {str(e)}'
        })

# Return/Refund Feature Routes
@app.route('/request-return', methods=['POST'])
def request_return():
    """Customer requests return/refund for a delivered order"""
    data = request.json
    order_id = data.get('order_id')
    customer_gmail = data.get('customer_gmail', '').strip().lower()
    reason_1 = data.get('reason_1', '').strip()
    reason_2 = data.get('reason_2', '').strip()
    
    if not order_id or not customer_gmail:
        return jsonify({'success': False, 'message': 'Order ID and customer email are required'})
    
    if not reason_1 or not reason_2:
        return jsonify({'success': False, 'message': 'Both reasons are required'})
    
    # Check if order exists and is delivered
    order = orders_collection.find_one({'order_id': order_id})
    if not order:
        return jsonify({'success': False, 'message': 'Order not found'})
    
    if order.get('status') != 'delivered':
        return jsonify({'success': False, 'message': 'Only delivered orders can be returned'})
    
    # Check if return request already exists
    existing_request = return_requests_collection.find_one({
        'order_id': order_id,
        'status': {'$in': ['pending', 'approved']}
    })
    if existing_request:
        return jsonify({'success': False, 'message': 'A return request already exists for this order'})
    
    # Create return request
    return_request = {
        'order_id': order_id,
        'customer_gmail': customer_gmail,
        'reason_1': reason_1,
        'reason_2': reason_2,
        'status': 'pending',
        'created_at': datetime.now().isoformat(),
        'approved_at': None,
        'notes': ''
    }
    
    result = return_requests_collection.insert_one(return_request)
    
    if result.inserted_id:
        # Create notification for owner
        owner = users_collection.find_one({'role': 'owner'})
        print(f"[DEBUG] Found owner: {owner}")
        if owner:
            owner_email = owner.get('gmail', '').strip().lower()
            print(f"[DEBUG] Owner email: {owner_email}")
            if owner_email:
                notification_doc = {
                    'recipient': owner_email,
                    'type': 'return_request',
                    'order_id': order_id,
                    'customer': customer_gmail,
                    'message': f"Return request from {customer_gmail} for order {order_id}",
                    'status': 'pending',
                    'created_at': datetime.now().isoformat(),
                    'date': datetime.now().strftime('%Y-%m-%d'),
                    'read': False
                }
                print(f"[DEBUG] Creating notification: {notification_doc}")
                result_notif = notifications_collection.insert_one(notification_doc)
                print(f"[DEBUG] Notification inserted with ID: {result_notif.inserted_id}")
        
        return jsonify({'success': True, 'message': 'Return request submitted successfully'})
    
    return jsonify({'success': False, 'message': 'Failed to create return request'})

@app.route('/get-return-requests', methods=['GET'])
def get_return_requests():
    """Get all return requests (for owner)"""
    try:
        return_requests = list(return_requests_collection.find({}).sort('created_at', -1))
        
        for req in return_requests:
            req['_id'] = str(req['_id'])
            # Get order details
            order = orders_collection.find_one({'order_id': req['order_id']})
            if order:
                req['order_total'] = order.get('total', 0)
                req['order_items'] = order.get('items', [])
            
            # Format date
            if 'created_at' in req:
                req['formatted_date'] = datetime.fromisoformat(req['created_at']).strftime('%Y-%m-%d %H:%M')
        
        return jsonify({'success': True, 'return_requests': return_requests})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error fetching return requests: {str(e)}'})

@app.route('/get-customer-return-requests', methods=['POST'])
def get_customer_return_requests():
    """Get return requests for a specific customer"""
    data = request.json
    customer_gmail = data.get('customer_gmail')
    
    if not customer_gmail:
        return jsonify({'success': False, 'message': 'Customer email required'})
    
    try:
        return_requests = list(return_requests_collection.find({
            'customer_gmail': customer_gmail
        }).sort('created_at', -1))
        
        for req in return_requests:
            req['_id'] = str(req['_id'])
            # Format date
            if 'created_at' in req:
                req['formatted_date'] = datetime.fromisoformat(req['created_at']).strftime('%Y-%m-%d %H:%M')
        
        return jsonify({'success': True, 'return_requests': return_requests})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error fetching return requests: {str(e)}'})

@app.route('/approve-return', methods=['POST'])
def approve_return():
    """Owner approves a return request"""
    data = request.json
    order_id = data.get('order_id')
    notes = data.get('notes', '').strip()
    
    if not order_id:
        return jsonify({'success': False, 'message': 'Order ID required'})
    
    try:
        # Update return request status
        result = return_requests_collection.update_one(
            {'order_id': order_id},
            {
                '$set': {
                    'status': 'approved',
                    'approved_at': datetime.now().isoformat(),
                    'notes': notes
                }
            }
        )
        
        if result.modified_count > 0:
            # Get the return request and order details
            return_req = return_requests_collection.find_one({'order_id': order_id})
            customer_gmail = return_req.get('customer_gmail')
            
            # Create notification for customer
            notifications_collection.insert_one({
                'recipient': customer_gmail,
                'type': 'return_approved',
                'order_id': order_id,
                'message': f"Your return request for order {order_id} has been approved",
                'created_at': datetime.now().isoformat(),
                'read': False
            })
            
            return jsonify({'success': True, 'message': 'Return request approved'})
        
        return jsonify({'success': False, 'message': 'Return request not found'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error approving return: {str(e)}'})

@app.route('/disapprove-return', methods=['POST'])
def disapprove_return():
    """Owner disapproves a return request"""
    data = request.json
    order_id = data.get('order_id')
    reason = data.get('reason', '').strip()
    
    if not order_id:
        return jsonify({'success': False, 'message': 'Order ID required'})
    
    try:
        # Update return request status
        result = return_requests_collection.update_one(
            {'order_id': order_id},
            {
                '$set': {
                    'status': 'disapproved',
                    'approved_at': datetime.now().isoformat(),
                    'notes': reason
                }
            }
        )
        
        if result.modified_count > 0:
            # Get the return request details
            return_req = return_requests_collection.find_one({'order_id': order_id})
            customer_gmail = return_req.get('customer_gmail')
            
            # Create notification for customer
            notifications_collection.insert_one({
                'recipient': customer_gmail,
                'type': 'return_disapproved',
                'order_id': order_id,
                'message': f"Your return request for order {order_id} has been disapproved",
                'created_at': datetime.now().isoformat(),
                'read': False
            })
            
            return jsonify({'success': True, 'message': 'Return request disapproved'})
        
        return jsonify({'success': False, 'message': 'Return request not found'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error disapproving return: {str(e)}'})

if __name__ == '__main__':
    seed_data()
    print("\n" + "="*60)
    print("  Welcome to Juana's Ribbon!")
    print("  Open your browser and go to: http://localhost:8000")
    print("="*60 + "\n")
    app.run(debug=True, port=8000)
