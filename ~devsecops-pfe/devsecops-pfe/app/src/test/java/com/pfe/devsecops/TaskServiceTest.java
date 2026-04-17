package com.pfe.devsecops;

import com.pfe.devsecops.model.Task;
import com.pfe.devsecops.repository.TaskRepository;
import com.pfe.devsecops.service.TaskService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TaskServiceTest {

    @Mock
    private TaskRepository taskRepository;

    @InjectMocks
    private TaskService taskService;

    @BeforeEach
    void setUp() { MockitoAnnotations.openMocks(this); }

    @Test
    void findAll_shouldReturnAllTasks() {
        Task t1 = new Task(); t1.setTitle("Task 1");
        Task t2 = new Task(); t2.setTitle("Task 2");
        when(taskRepository.findAll()).thenReturn(Arrays.asList(t1, t2));
        List<Task> result = taskService.findAll();
        assertEquals(2, result.size());
        verify(taskRepository, times(1)).findAll();
    }

    @Test
    void findById_shouldReturnTask_whenExists() {
        Task task = new Task(); task.setId(1L); task.setTitle("Test Task");
        when(taskRepository.findById(1L)).thenReturn(Optional.of(task));
        Optional<Task> result = taskService.findById(1L);
        assertTrue(result.isPresent());
        assertEquals("Test Task", result.get().getTitle());
    }

    @Test
    void findById_shouldReturnEmpty_whenNotExists() {
        when(taskRepository.findById(99L)).thenReturn(Optional.empty());
        Optional<Task> result = taskService.findById(99L);
        assertFalse(result.isPresent());
    }

    @Test
    void save_shouldPersistTask() {
        Task task = new Task(); task.setTitle("New Task");
        when(taskRepository.save(task)).thenReturn(task);
        Task saved = taskService.save(task);
        assertNotNull(saved);
        assertEquals("New Task", saved.getTitle());
    }

    @Test
    void delete_shouldCallRepository() {
        doNothing().when(taskRepository).deleteById(1L);
        taskService.delete(1L);
        verify(taskRepository, times(1)).deleteById(1L);
    }
}
