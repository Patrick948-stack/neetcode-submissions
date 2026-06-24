#include <vector>
#include <unordered_map>
using namespace std;
class Solution {
public:
    bool hasDuplicate(vector<int>& nums) {
        
        // create a hashmap called nums_hsh
        unordered_map<int, int> nums_hsh;

        // Iterated through the array nums
        for (const int& nbr : nums) {
            nums_hsh[nbr]++;
        }
        for (const auto& pair : nums_hsh) {
            if (pair.second >= 2) {
                return true;
            } else {
                continue;
            }

        
        
        }

        // For each element, if it exists in the numps_hsp, increment it
        // if it doesn't, create it

        // iterate through the hashmap and 
        // if a value is greater or equal to 2, return true, and stop the program
        // if loop ends without this break, return false
        return false;
    }
};