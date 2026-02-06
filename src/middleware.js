const requireAuth = (req, res, next) => {
    next();
};

const requireAdmin = (req, res, next) => {
    next();
};

module.exports = { requireAuth, requireAdmin };
