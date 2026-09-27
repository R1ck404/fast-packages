use super::heap_alloc::WrapBox;
use super::{Allocator};
#[derive(Default, Clone, Copy, Debug)]
pub struct StandardAlloc{}

impl<T: Clone+Default> Allocator<T> for StandardAlloc {
   type AllocatedMemory = WrapBox<T>;
   fn alloc_cell(&mut self, len : usize) -> WrapBox<T> {
       vec![T::default().clone();len].into()
   }
   fn free_cell(&mut self, _data : WrapBox<T>) {

   }
   // fast-brotli-wasm: no zeroing (only used for integer tables)
   fn alloc_cell_uninit(&mut self, len : usize) -> WrapBox<T> {
       let mut v = std::vec::Vec::<T>::with_capacity(len);
       unsafe { v.set_len(len) };
       v.into()
   }
}
