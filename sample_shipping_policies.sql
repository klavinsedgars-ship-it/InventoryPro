INSERT INTO shipping_policies (id, name, description, min_weight, max_weight, type) VALUES
('policy_light', 'Light Items', 'For lightweight electronics under 100g', 0, 100, 'standard'),
('policy_standard', 'Standard Items', 'For regular electronics 100g-500g', 101, 500, 'standard'),
('policy_heavy', 'Heavy Items', 'For heavy electronics over 500g', 501, 10000, 'standard');
