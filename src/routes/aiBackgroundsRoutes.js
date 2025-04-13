const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Path to the AI backgrounds JSON file
const backgroundsFilePath = path.join(__dirname, "../lib/ai_backgrounds.json");

/**
 * @route GET /api/backgrounds
 * @desc Get AI backgrounds with pagination
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Number of items per page (default: 10)
 * @query {string} category - Filter by category (optional)
 * @returns {object} JSON response with paginated backgrounds and metadata
 */
router.get("/backgrounds", (req, res) => {
  try {
    // Read the backgrounds data from the JSON file
    const backgroundsData = JSON.parse(
      fs.readFileSync(backgroundsFilePath, "utf8")
    );

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const category = req.query.category;

    // Filter by category if provided
    let filteredData = backgroundsData;
    if (category) {
      filteredData = backgroundsData.filter(
        (item) =>
          item &&
          item.category &&
          item.category.toLowerCase() === category.toLowerCase()
      );
    }

    // Calculate pagination values
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    // Prepare response object
    const response = {
      success: true,
      pagination: {
        total: filteredData.length,
        totalPages: Math.ceil(filteredData.length / limit),
        currentPage: page,
        limit: limit,
        hasNext: endIndex < filteredData.length,
        hasPrev: page > 1,
      },
      data: filteredData.slice(startIndex, endIndex),
    };

    res.json(response);
  } catch (error) {
    console.error("Error retrieving backgrounds:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving backgrounds",
      error: error.message,
    });
  }
});

/**
 * @route GET /api/backgrounds/categories
 * @desc Get all available background categories
 * @returns {object} JSON response with all categories
 */
router.get("/backgrounds/categories", (req, res) => {
  try {
    // Read the backgrounds data from the JSON file
    const backgroundsData = JSON.parse(
      fs.readFileSync(backgroundsFilePath, "utf8")
    );

    // Extract unique categories
    const categories = [
      ...new Set(
        backgroundsData
          .filter((item) => item && item.category)
          .map((item) => item.category)
      ),
    ];

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Error retrieving background categories:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving background categories",
      error: error.message,
    });
  }
});

/**
 * @route GET /api/backgrounds/:category/subcategories
 * @desc Get all subcategories for a specific category
 * @param {string} category - The category to get subcategories for
 * @returns {object} JSON response with all subcategories for the category
 */
router.get("/backgrounds/:category/subcategories", (req, res) => {
  try {
    // Read the backgrounds data from the JSON file
    const backgroundsData = JSON.parse(
      fs.readFileSync(backgroundsFilePath, "utf8")
    );

    // Get the category from params
    const { category } = req.params;

    // Find the category in the data
    const categoryData = backgroundsData.find(
      (item) =>
        item &&
        item.category &&
        item.category.toLowerCase() === category.toLowerCase()
    );

    if (!categoryData || !categoryData.subCategories) {
      return res.status(404).json({
        success: false,
        message: `Category '${category}' not found or has no subcategories`,
      });
    }

    // Extract subcategories
    const subcategories = categoryData.subCategories
      .filter((sub) => sub && sub.subCategory)
      .map((sub) => sub.subCategory);

    res.json({
      success: true,
      category: category,
      data: subcategories,
    });
  } catch (error) {
    console.error("Error retrieving subcategories:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving subcategories",
      error: error.message,
    });
  }
});

module.exports = router;
