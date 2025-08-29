-- Sample database schema and data for testing the NL-to-SQL chatbot
-- This creates a typical e-commerce/business database structure

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

COMMENT ON TABLE users IS 'Customer and user information';
COMMENT ON COLUMN users.email IS 'Unique email address for login';
COMMENT ON COLUMN users.is_active IS 'Whether the user account is active';

-- Products table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    category_id INTEGER,
    stock_quantity INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

COMMENT ON TABLE products IS 'Product catalog with pricing and inventory';
COMMENT ON COLUMN products.price IS 'Product price in USD';
COMMENT ON COLUMN products.stock_quantity IS 'Available inventory count';

-- Categories table
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE categories IS 'Product categories and subcategories';
COMMENT ON COLUMN categories.parent_id IS 'Reference to parent category for hierarchical structure';

-- Orders table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shipped_date TIMESTAMP,
    delivery_address TEXT
);

COMMENT ON TABLE orders IS 'Customer orders and order tracking';
COMMENT ON COLUMN orders.status IS 'Order status: pending, processing, shipped, delivered, cancelled';
COMMENT ON COLUMN orders.total_amount IS 'Total order value in USD';

-- Order items table
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL
);

COMMENT ON TABLE order_items IS 'Individual items within each order';
COMMENT ON COLUMN order_items.unit_price IS 'Price per unit at time of order';
COMMENT ON COLUMN order_items.total_price IS 'Total price for this line item';

-- Reviews table
CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE reviews IS 'Product reviews and ratings from customers';
COMMENT ON COLUMN reviews.rating IS 'Rating from 1 to 5 stars';

-- Add foreign key constraints
ALTER TABLE products ADD CONSTRAINT fk_products_category 
    FOREIGN KEY (category_id) REFERENCES categories(id);

ALTER TABLE categories ADD CONSTRAINT fk_categories_parent 
    FOREIGN KEY (parent_id) REFERENCES categories(id);

ALTER TABLE orders ADD CONSTRAINT fk_orders_user 
    FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order 
    FOREIGN KEY (order_id) REFERENCES orders(id);

ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product 
    FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE reviews ADD CONSTRAINT fk_reviews_user 
    FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE reviews ADD CONSTRAINT fk_reviews_product 
    FOREIGN KEY (product_id) REFERENCES products(id);

-- Insert sample data

-- Categories
INSERT INTO categories (name, description) VALUES
('Electronics', 'Electronic devices and gadgets'),
('Clothing', 'Apparel and fashion items'),
('Books', 'Books and educational materials'),
('Home & Garden', 'Home improvement and gardening supplies'),
('Sports', 'Sports equipment and fitness gear');

INSERT INTO categories (name, description, parent_id) VALUES
('Smartphones', 'Mobile phones and accessories', 1),
('Laptops', 'Portable computers', 1),
('Men''s Clothing', 'Clothing for men', 2),
('Women''s Clothing', 'Clothing for women', 2);

-- Users
INSERT INTO users (email, first_name, last_name) VALUES
('john.doe@example.com', 'John', 'Doe'),
('jane.smith@example.com', 'Jane', 'Smith'),
('bob.johnson@example.com', 'Bob', 'Johnson'),
('alice.brown@example.com', 'Alice', 'Brown'),
('charlie.wilson@example.com', 'Charlie', 'Wilson');

-- Products
INSERT INTO products (name, description, price, category_id, stock_quantity) VALUES
('iPhone 15 Pro', 'Latest Apple smartphone with advanced features', 999.99, 6, 50),
('Samsung Galaxy S24', 'High-end Android smartphone', 899.99, 6, 30),
('MacBook Pro 16"', 'Professional laptop for creative work', 2499.99, 7, 15),
('Dell XPS 13', 'Ultrabook for business and personal use', 1299.99, 7, 25),
('Nike Air Max', 'Comfortable running shoes', 129.99, 5, 100),
('Levi''s 501 Jeans', 'Classic denim jeans', 79.99, 8, 75),
('The Great Gatsby', 'Classic American novel', 12.99, 3, 200),
('Yoga Mat', 'Non-slip exercise mat', 29.99, 5, 150);

-- Orders
INSERT INTO orders (user_id, total_amount, status, order_date) VALUES
(1, 999.99, 'delivered', '2024-01-15 10:30:00'),
(2, 1429.98, 'shipped', '2024-01-20 14:15:00'),
(3, 159.98, 'delivered', '2024-01-18 09:45:00'),
(1, 2499.99, 'processing', '2024-01-25 16:20:00'),
(4, 42.98, 'delivered', '2024-01-22 11:10:00');

-- Order items
INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES
(1, 1, 1, 999.99, 999.99),
(2, 5, 1, 129.99, 129.99),
(2, 4, 1, 1299.99, 1299.99),
(3, 5, 1, 129.99, 129.99),
(3, 8, 1, 29.99, 29.99),
(4, 3, 1, 2499.99, 2499.99),
(5, 7, 1, 12.99, 12.99),
(5, 8, 1, 29.99, 29.99);

-- Reviews
INSERT INTO reviews (user_id, product_id, rating, comment) VALUES
(1, 1, 5, 'Excellent phone with great camera quality'),
(2, 5, 4, 'Very comfortable shoes, great for running'),
(3, 5, 5, 'Best running shoes I''ve ever owned'),
(1, 3, 5, 'Perfect laptop for video editing and development'),
(4, 7, 4, 'Classic book, well worth reading'),
(2, 4, 4, 'Good laptop for the price, lightweight and fast');

-- Create indexes for better query performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);