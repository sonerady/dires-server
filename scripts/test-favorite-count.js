const express = require('express');

const testFavoriteCount = async () => {
  try {
    console.log('🧪 Testing favorite count API...');
    
    // Test discovery locations
    const response = await fetch("http://localhost:3001/api/location/v2/public-locations?category=custom&limit=5&shuffle=true");
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    console.log('✅ API Response success:', result.success);
    console.log('📊 Total locations:', result.total);
    console.log('📋 Locations with favorite_count:');
    
    if (result.data && result.data.length > 0) {
      result.data.forEach((location, index) => {
        console.log(`  ${index + 1}. ${location.title || location.generated_title}`);
        console.log(`     ID: ${location.id}`);
        console.log(`     Favorite Count: ${location.favorite_count || 'undefined'}`);
        console.log(`     Image: ${location.image_url?.substring(0, 50)}...`);
        console.log('');
      });
    } else {
      console.log('❌ No locations found');
    }

    // Test favorites API
    console.log('\n🔍 Testing favorites API...');
    const favResponse = await fetch("http://localhost:3001/api/favorites/f47ac10b-58cc-4372-a567-0e02b2c3d479");
    
    if (favResponse.ok) {
      const favResult = await favResponse.json();
      console.log('✅ Favorites API success:', favResult.success);
      console.log('💖 Total favorites:', favResult.total);
      
      if (favResult.data && favResult.data.length > 0) {
        console.log('📋 Favorite locations:');
        favResult.data.forEach((fav, index) => {
          console.log(`  ${index + 1}. ${fav.location_title}`);
          console.log(`     Favorite Count: ${fav.favorite_count || 'undefined'}`);
          console.log('');
        });
      }
    } else {
      console.log('❌ Favorites API failed:', favResponse.status);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

testFavoriteCount();
